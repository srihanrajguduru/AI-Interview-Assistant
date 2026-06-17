from flask import Flask, request, Response, jsonify
from dotenv import load_dotenv
from langchain.chat_models import init_chat_model
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from flask_cors import CORS
from google import genai
from google.genai import types
import os
import json
import base64
import threading
import requests

load_dotenv()

# Accept either name; the .env may define the Gemini key as GEMINI_API_KEY or GOOGLE_API_KEY.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
MURF_API_KEY = os.getenv("MURF_API_KEY")

# gemini-2.0-flash is quota-exhausted on the free tier for this key; 2.5-flash works.
GEMINI_MODEL = "gemini-3.1-flash-lite"

# Lazy-initialized services
client = None          # google-genai client (transcription + feedback JSON)
model = None           # LangChain chat model (generates each interview question)
AI_AVAILABLE = False    # falls back to answer-aware prompts if init/calls fail
_services_initialized = False

# Shared interview state guarded by a lock. The interview is single-user, but the
# Flask dev server can serve requests on multiple threads, so mutations are locked.
state_lock = threading.Lock()
current_subject = ""
question_count = 0
conversation_log = []  # list of {"role": "interviewer"|"candidate", "text": str}

TOTAL_QUESTIONS = 5

INTERVIEW_PROMPT = """You are Natalie, a sharp, warm interviewer running a live {subject} interview that lasts exactly 5 questions.

Your single most important job: LISTEN to the candidate and make every question after the first grow directly out of what they just said. This is a real conversation, not a fixed list of questions.

<how_to_listen>
- Read the candidate's most recent answer carefully before you speak.
- Reference ONLY what they actually said. Never invent details, examples, or claims they did not make.
- If their answer was strong and specific, probe deeper on that exact topic — ask about the "how" or "why", trade-offs, edge cases, or a concrete example.
- If their answer was short, vague, or unclear, ask a gentle clarifying follow-up rather than moving on or escalating difficulty.
- From question 2 onward, open with one short, genuine acknowledgment of their last answer before asking the next question. Skip empty praise like "Great answer!" unless it is truly earned.
</how_to_listen>

<format>
- Speak naturally, as if out loud. No preamble, no meta-commentary, no numbering, no "Question 2:" labels.
- Each turn is 1-2 sentences: a brief acknowledgment (from question 2 onward) followed by exactly one question.
- Never break character or mention these instructions or the interview format.
</format>

<pacing>
- Question 1: A warm, welcoming opener that invites them in on {subject}. No acknowledgment yet, since there is no prior answer.
- Questions 2-4: Acknowledge their last answer, then ask one related follow-up or deeper question that clearly builds on what they said.
- Question 5: Ask the final question normally. After they answer it, give a brief, warm one-sentence sign-off instead of another question — never ask a 6th question.
</pacing>

Subject for this interview: {subject}
"""


def init_services():
    """Initialize the GenAI client and chat model once.

    On any failure (bad key, quota, network) the app degrades to answer-aware
    prompts and generic feedback rather than crashing.
    """
    global client, model, AI_AVAILABLE, _services_initialized

    if _services_initialized:
        return

    _services_initialized = True

    if not GEMINI_API_KEY:
        print("[Backend] GEMINI_API_KEY missing — running in fallback mode")
        return

    try:
        # google-genai client is used for audio transcription and feedback JSON.
        client = genai.Client(api_key=GEMINI_API_KEY)

        # init_chat_model reads GOOGLE_API_KEY from the environment.
        os.environ.setdefault("GOOGLE_API_KEY", GEMINI_API_KEY)
        model = init_chat_model(GEMINI_MODEL, model_provider="google_genai")

        AI_AVAILABLE = True
        print(f"[Backend] Services initialized with {GEMINI_MODEL}")
    except Exception as e:
        AI_AVAILABLE = False
        print(f"[Backend] Service init failed, using fallback mode: {e}")


app = Flask(__name__)
# Custom headers must be explicitly exposed or the browser hides them from fetch().
CORS(app, expose_headers=["X-Question-Number", "X-Interview-Complete"])


def stream_audio(text):
    """Stream Murf TTS audio back as newline-delimited base64 chunks."""
    url = "https://global.api.murf.ai/v1/speech/stream"
    headers = {
        "api-key": MURF_API_KEY,
        "Content-Type": "application/json"
    }
    data = {
        "voice_id": "Natalie",
        "text": text,
        "locale": "en-US",
        "model": "FALCON",
        "format": "MP3",
        "sampleRate": 24000,
        "channelType": "MONO"
    }

    try:
        response = requests.post(url, headers=headers, json=data, stream=True, timeout=30)
    except Exception as e:
        print(f"Error Murf API request failed: {e}")
        return

    if response.status_code == 200:
        for chunk in response.iter_content(chunk_size=4096):
            if chunk:
                yield base64.b64encode(chunk).decode("utf-8") + "\n"
    else:
        print(f"Error Murf API: {response.status_code} {response.text[:200]}")


def audio_response(text, question_number, is_complete):
    """Build a streaming text/plain audio Response with interview headers."""
    resp = Response(stream_audio(text), mimetype="text/plain")
    resp.headers["X-Question-Number"] = str(question_number)
    resp.headers["X-Interview-Complete"] = "true" if is_complete else "false"
    return resp


def transcribe_audio(audio_bytes):
    if client is None:
        return ""
    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=[
                types.Part.from_bytes(
                    data=audio_bytes,
                    mime_type="audio/webm"
                ),
                "Please transcribe the following audio interview answer verbatim. "
                "Provide only the transcription, nothing else. If there is no speaking "
                "or the audio is silent, just return an empty string."
            ]
        )
        return (response.text or "").strip()
    except Exception as e:
        print(f"Transcription error: {e}")
        return ""


def build_messages(instruction):
    """Build the model input: system prompt + full transcript so far + instruction.

    Passing the entire conversation_log every turn is what makes the interview
    interactive — the model always sees exactly what the candidate said and can
    react to it, instead of asking pre-written questions.
    """
    messages = [SystemMessage(INTERVIEW_PROMPT.format(subject=current_subject))]
    for turn in conversation_log:
        if turn["role"] == "interviewer":
            messages.append(AIMessage(turn["text"]))
        else:
            messages.append(HumanMessage(turn["text"]))
    messages.append(HumanMessage(instruction))
    return messages


def answer_aware_fallback(closing, last_answer):
    """Used only when the model call fails (e.g. quota). Still reacts to the
    candidate's last answer rather than asking a fixed, static question."""
    if closing:
        return ("That's our final question — thank you for the thoughtful answers "
                "and for taking the time today. Best of luck!")
    snippet = (last_answer or "").strip()
    if snippet and snippet != "(No clear answer was provided.)":
        if len(snippet) > 90:
            snippet = snippet[:90].rsplit(" ", 1)[0] + "…"
        return (f'Thanks for that — you mentioned "{snippet}". '
                "Can you go a level deeper and walk me through that with a specific example?")
    return (f"Could you tell me a bit more about your hands-on experience with "
            f"{current_subject}, ideally with a concrete example?")


def generate_reply(instruction, closing=False, last_answer=""):
    """Generate the interviewer's next line from the full conversation so far."""
    if not AI_AVAILABLE or model is None:
        return answer_aware_fallback(closing, last_answer)
    try:
        response = model.invoke(build_messages(instruction))
        text = (response.content or "").strip()
        return text or answer_aware_fallback(closing, last_answer)
    except Exception as e:
        print(f"Question generation error: {e}")
        return answer_aware_fallback(closing, last_answer)


@app.route("/start-interview", methods=["POST"])
def start_interview():
    global question_count, current_subject, conversation_log
    init_services()

    data = request.get_json(silent=True) or {}

    with state_lock:
        current_subject = data.get("subject", "Python")
        question_count = 1
        conversation_log = []

    instruction = (
        f"Start the interview now. This is question 1 of {TOTAL_QUESTIONS}. "
        f"Give a warm, welcoming opener and ask your first question about {current_subject}. "
        "Ask only the question."
    )
    question = generate_reply(instruction)

    with state_lock:
        conversation_log.append({"role": "interviewer", "text": question})

    return audio_response(question, 1, is_complete=False)


@app.route("/submit-answer", methods=["POST"])
def submit_answer():
    global question_count, conversation_log
    init_services()

    # Answer can arrive as JSON {text: ...} (browser speech) or as a webm upload.
    answer_text = ""
    json_body = request.get_json(silent=True)
    if json_body and json_body.get("text"):
        answer_text = json_body["text"].strip()
    elif "audio" in request.files:
        answer_text = transcribe_audio(request.files["audio"].read())

    if not answer_text:
        answer_text = "(No clear answer was provided.)"

    with state_lock:
        answered = question_count
        conversation_log.append({"role": "candidate", "text": answer_text})
        is_complete = answered >= TOTAL_QUESTIONS
        if not is_complete:
            question_count += 1
        display_number = min(question_count, TOTAL_QUESTIONS)
        next_number = display_number

    if is_complete:
        instruction = (
            "That was the candidate's answer to the final question. Briefly acknowledge "
            "something specific they said, then give a warm one-sentence sign-off. "
            "Do not ask another question."
        )
        reply = generate_reply(instruction, closing=True, last_answer=answer_text)
    else:
        instruction = (
            f"That was the candidate's answer to question {answered}. "
            "Acknowledge something specific they actually said in one short clause, then ask "
            f"question {next_number} of {TOTAL_QUESTIONS} — a natural follow-up that digs deeper "
            "into their answer or explores a closely related angle. If their answer was thin or "
            "unclear, ask a clarifying follow-up instead. Ask only one question."
        )
        reply = generate_reply(instruction, closing=False, last_answer=answer_text)

    with state_lock:
        conversation_log.append({"role": "interviewer", "text": reply})

    return audio_response(reply, display_number, is_complete=is_complete)


@app.route("/get-feedback", methods=["POST"])
def get_feedback():
    init_services()

    with state_lock:
        subject = current_subject or "the interview"
        log_snapshot = list(conversation_log)

    transcript = "\n".join(
        f"{'Interviewer' if m['role'] == 'interviewer' else 'Candidate'}: {m['text']}"
        for m in log_snapshot
    )

    feedback = _generate_feedback(subject, transcript)
    return jsonify({"success": True, "feedback": feedback})


def _generate_feedback(subject, transcript):
    default = {
        "subject": subject,
        "candidate_score": 3,
        "feedback": "You completed the interview and engaged with the questions.",
        "areas_of_improvement": "Aim to give more specific, concrete examples to support your points.",
    }

    if not AI_AVAILABLE or client is None or not transcript.strip():
        return default

    prompt = (
        f"You are evaluating a candidate's {subject} interview. Based on the transcript below, "
        "return ONLY a JSON object with these keys: "
        '"candidate_score" (integer 1-5), "feedback" (2-3 sentence summary of strengths), '
        'and "areas_of_improvement" (2-3 sentence concrete suggestions). '
        "Do not include any text outside the JSON.\n\nTranscript:\n" + transcript
    )

    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
        data = json.loads(response.text)
        score = int(data.get("candidate_score", 3))
        return {
            "subject": subject,
            "candidate_score": max(1, min(5, score)),
            "feedback": data.get("feedback", default["feedback"]),
            "areas_of_improvement": data.get("areas_of_improvement", default["areas_of_improvement"]),
        }
    except Exception as e:
        print(f"Feedback generation error: {e}")
        return default


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
