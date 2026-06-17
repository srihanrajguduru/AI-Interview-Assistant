

// Global State
let mediaRecorder = null;
let recordingChunks = [];
let recordedBlob = null;
let currentSubject = null;
let isSpeaking = false;
let currentAudio = null;
let recognition = null;
let transcriptionText = "";

// Initialize Web Speech API for local free transcription
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    
    recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                transcriptionText += event.results[i][0].transcript + " ";
            }
        }
        console.log("Transcribed text so far:", transcriptionText);
    };
    
    recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
    };
}

// DOM Elements
const welcomeState = document.getElementById("welcomeState");
const interviewState = document.getElementById("interviewState");
const subjectBtns = document.querySelectorAll(".subject-btn");
const subjectBadge = document.getElementById("subjectBadge");
const subjectIcon = document.getElementById("subjectIcon");
const questionNum = document.getElementById("questionNum");
const speakingBubble = document.getElementById("speakingBubble");
const startInterviewBtn = document.getElementById("startInterviewBtn");
const recordBtn = document.getElementById("recordBtn");
const micIcon = document.getElementById("micIcon");
const stopIcon = document.getElementById("stopIcon");
const recordingStatus = document.getElementById("recordingStatus");
const submitBtn = document.getElementById("submitBtn");
const endInterviewBtn = document.getElementById("endInterviewBtn");
const feedbackSection = document.getElementById("feedbackSection");
const getFeedbackArea = document.getElementById("getFeedbackArea");
const getFeedbackBtn = document.getElementById("getFeedbackBtn");
const feedbackContent = document.getElementById("feedbackContent");
const feedbackSubject = document.getElementById("feedbackSubject");
const scoreCircle = document.getElementById("scoreCircle");
const scoreValue = document.getElementById("scoreValue");
const feedbackText = document.getElementById("feedbackText");
const improvementText = document.getElementById("improvementText");
const newInterviewBtn = document.getElementById("newInterviewBtn");

// Subject Icons Map
const iconMap = {
    "Self Introduction": "fas fa-user text-blue-400",
    "Generative AI": "fas fa-brain text-purple-400",
    "Python": "fab fa-python text-yellow-400",
    "English": "fas fa-language text-green-400",
    "HTML": "fab fa-html5 text-orange-400",
    "CSS": "fab fa-css3-alt text-blue-400"
};


// ========== UI STATE FUNCTIONS ==========

function showInterviewPanel(subject) {
    currentSubject = subject;
    
    subjectBtns.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.subject === subject);
    });
    
    welcomeState.classList.add("hidden");
    interviewState.classList.remove("hidden");
    feedbackSection.classList.add("hidden");
    
    subjectBadge.textContent = subject;
    subjectIcon.className = iconMap[subject] + " text-2xl";
    questionNum.textContent = "1";
    
    speakingBubble.classList.add("hidden");
    startInterviewBtn.classList.remove("hidden");
    recordBtn.classList.add("hidden");
    recordBtn.disabled = true;
    submitBtn.disabled = true;
    endInterviewBtn.disabled = true;
    recordingStatus.textContent = "Click Start Interview to begin";
}

function updateQuestionNumber(number) {
    questionNum.textContent = number;
}

function showSpeakingBubble() {
    speakingBubble.classList.remove("hidden");
}

function hideSpeakingBubble() {
    speakingBubble.classList.add("hidden");
}

function enableRecording() {
    recordBtn.disabled = false;
    endInterviewBtn.disabled = false;
    recordingStatus.textContent = "Click to record";
}

function disableRecording() {
    recordBtn.disabled = true;
    submitBtn.disabled = true;
    submitBtn.classList.add("hidden");
}

function showFeedbackSection() {
    feedbackSection.classList.remove("hidden");
    getFeedbackArea.classList.remove("hidden");
    feedbackContent.classList.add("hidden");
    endInterviewBtn.disabled = true;
    disableRecording();
    recordingStatus.textContent = "Interview ended";
    hideSpeakingBubble();
}

function displayFeedback(data) {
    feedbackSubject.textContent = data.subject || currentSubject;
    scoreValue.textContent = data.candidate_score || 0;
    
    const offset = 251.2 - ((data.candidate_score || 0) / 5) * 251.2;
    scoreCircle.style.strokeDashoffset = offset;
    
    feedbackText.textContent = data.feedback || "No feedback available";
    improvementText.textContent = data.areas_of_improvement || "No suggestions available";
    
    getFeedbackArea.classList.add("hidden");
    feedbackContent.classList.remove("hidden");
}

function resetToWelcome() {
    currentSubject = null;
    isSpeaking = false;
    mediaRecorder = null;
    recordingChunks = [];
    recordedBlob = null;
    transcriptionText = "";
    
    if (recognition) {
        try {
            recognition.stop();
        } catch (e) {}
    }
    
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    
    subjectBtns.forEach((btn) => {
        btn.classList.remove("active");
    });
    
    welcomeState.classList.remove("hidden");
    interviewState.classList.add("hidden");
    
    recordBtn.classList.remove("bg-red-500", "text-white", "recording-active");
    recordBtn.classList.add("bg-zinc-800/80", "text-gray-400");
    micIcon.classList.remove("hidden");
    stopIcon.classList.add("hidden");
    submitBtn.classList.add("hidden");
    
    speakingBubble.classList.add("hidden");
    
    scoreCircle.style.strokeDashoffset = 251.2;
    getFeedbackBtn.textContent = "Get Feedback";
    getFeedbackBtn.disabled = false;
}


// ========== AUDIO FUNCTIONS ==========

function handleAudioStream(response, onComplete) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let chunks = [];
    let leftover = "";

    // Only show speaking bubble when actually streaming audio
    speakingBubble.classList.remove("hidden");
    isSpeaking = true;
    recordBtn.disabled = true;
    recordingStatus.textContent = "Listening...";

    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }

    function processChunk({ done, value }) {
        if (done) {
            if (leftover.trim()) {
                try {
                    const binaryString = atob(leftover.trim());
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    chunks.push(bytes);
                } catch (e) {
                    console.error("Base64 decode error on final chunk:", e);
                }
            }

            if (chunks.length === 0) {
                console.error("No audio chunks received");
                recordingStatus.textContent = "No audio received";
                if (onComplete) onComplete();
                return;
            }

            let totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
            let audioBytes = new Uint8Array(totalLength);
            let offset = 0;
            for (let chunk of chunks) {
                audioBytes.set(chunk, offset);
                offset += chunk.length;
            }

            const blob = new Blob([audioBytes], { type: "audio/mpeg" });
            const audioUrl = URL.createObjectURL(blob);
            
            currentAudio = new Audio(audioUrl);
            currentAudio.play().catch((err) => {
                console.error("Audio playback failed:", err);
                recordingStatus.textContent = "Audio playback failed";
            });

            currentAudio.onended = () => {
                isSpeaking = false;
                speakingBubble.classList.add("hidden");
                enableRecording();
                URL.revokeObjectURL(audioUrl);
            };

            currentAudio.onerror = () => {
                isSpeaking = false;
                speakingBubble.classList.add("hidden");
                enableRecording();
                URL.revokeObjectURL(audioUrl);
            };

            if (onComplete) onComplete();
            return;
        }

        const textChunk = decoder.decode(value, { stream: true });
        const lines = textChunk.split("\n");
        lines[0] = leftover + lines[0];
        leftover = lines.pop();

        for (let line of lines) {
            if (!line.trim()) continue;
            try {
                const binaryString = atob(line.trim());
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                chunks.push(bytes);
            } catch (e) {
                console.error("Base64 decode error:", e, line);
            }
        }

        reader.read().then(processChunk);
    }

    reader.read().then(processChunk);
}


// ========== RECORDING FUNCTIONS ==========

function startRecording() {
    transcriptionText = "";
    if (recognition) {
        try {
            recognition.start();
        } catch (e) {
            console.error("Error starting speech recognition:", e);
        }
    }

    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        const options = { mimeType: "audio/webm;codecs=opus" };
        
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = "audio/webm";
        }
        
        mediaRecorder = new MediaRecorder(stream, options);
        recordingChunks = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                recordingChunks.push(e.data);
            }
        };
        
        mediaRecorder.onstop = () => {
            recordedBlob = new Blob(recordingChunks, { type: "audio/webm" });
            stream.getTracks().forEach((track) => track.stop());
        };

        mediaRecorder.start();
        
        recordBtn.classList.remove("bg-zinc-800/80", "text-gray-400");
        recordBtn.classList.add("bg-red-500", "text-white", "recording-active");
        micIcon.classList.add("hidden");
        stopIcon.classList.remove("hidden");
        recordingStatus.textContent = "Recording...";
        submitBtn.classList.add("hidden");
        endInterviewBtn.disabled = true;
    });
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
        
        if (recognition) {
            try {
                recognition.stop();
            } catch (e) {
                console.error("Error stopping speech recognition:", e);
            }
        }
        
        recordBtn.classList.remove("bg-red-500", "text-white", "recording-active");
        recordBtn.classList.add("bg-zinc-800/80", "text-gray-400");
        micIcon.classList.remove("hidden");
        stopIcon.classList.add("hidden");
        recordingStatus.textContent = "Recording complete";
        submitBtn.classList.remove("hidden");
        submitBtn.disabled = false;
    }
}


// ========== API FUNCTIONS ==========

const startInterviewApiUrl = "https://ai-interview-assistant-backend-klwb.onrender.com/start-interview";


async function startInterview() {
    startInterviewBtn.classList.add("hidden");
    recordBtn.classList.remove("hidden");
    recordingStatus.textContent = "Connecting...";
    
    try {
        const response = await fetch(startInterviewApiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subject: currentSubject })
        });
        
        const contentType = response.headers.get("content-type");
        
        if (contentType && contentType.includes("text/plain")) {
            handleAudioStream(response, () => {
                endInterviewBtn.disabled = false;
            });
        } else {
            const data = await response.json();
            console.log("Question:", data.question);
            enableRecording();
            endInterviewBtn.disabled = false;
        }
    } catch (error) {
        recordingStatus.textContent = "Backend not connected";
        hideSpeakingBubble();
        recordBtn.classList.add("hidden");
        startInterviewBtn.classList.remove("hidden");
    }
}

const submitAnswerApiUrl = "https://ai-interview-assistant-backend-klwb.onrender.com/submit-answer";


async function submitAnswer() {
    if (!recordedBlob && !transcriptionText.trim()) return;

    disableRecording();
    recordingStatus.textContent = "Submitting...";

    try {
        let response;
        if (transcriptionText.trim()) {
            response = await fetch(submitAnswerApiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: transcriptionText.trim() })
            });
        } else {
            const formData = new FormData();
            formData.append("audio", recordedBlob, "answer.webm");
            response = await fetch(submitAnswerApiUrl, {
                method: "POST",
                body: formData
            });
        }
        
        const contentType = response.headers.get("content-type");
        const isComplete = response.headers.get('X-Interview-Complete') === 'true';
        const questionNumber = response.headers.get('X-Question-Number');
        
        if (questionNumber) {
            updateQuestionNumber(questionNumber);
        }
        
        if (contentType && contentType.includes("text/plain")) {
            handleAudioStream(response, () => {
                recordedBlob = null;
                recordingChunks = [];
                
                if (isComplete) {
                    if (currentAudio) {
                        currentAudio.onended = () => {
                            isSpeaking = false;
                            hideSpeakingBubble();
                            showFeedbackSection();
                        };
                    } else {
                        isSpeaking = false;
                        hideSpeakingBubble();
                        showFeedbackSection();
                    }
                } else {
                    endInterviewBtn.disabled = false;
                }
            });
        } else {
            const data = await response.json();
            console.log("Response:", data);
            recordedBlob = null;
            recordingChunks = [];
            
            if (isComplete) {
                showFeedbackSection();
            } else {
                enableRecording();
                endInterviewBtn.disabled = false;
            }
        }
    } catch (error) {
        recordingStatus.textContent = "Connection error";
        hideSpeakingBubble();
        enableRecording();
    }
}



async function endInterview() {
    if (!confirm("End interview and get feedback?")) return;

    disableRecording();
    endInterviewBtn.disabled = true;
    recordingStatus.textContent = "Ending interview...";
    
    await getFeedback();
}

const getFeedbackApiUrl = "https://ai-interview-assistant-backend-klwb.onrender.com/get-feedback";

async function getFeedback() {
    showFeedbackSection();
    getFeedbackBtn.textContent = "Generating...";
    getFeedbackBtn.disabled = true;

    try {
        const response = await fetch(getFeedbackApiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({})
        });
        
        const data = await response.json();
        
        if (data.success) {
            displayFeedback(data.feedback);
        }
    } catch (error) {
        getFeedbackBtn.textContent = "Error - Retry";
        getFeedbackBtn.disabled = false;
    }
}


// ========== EVENT LISTENERS ==========

subjectBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
        if (currentSubject === btn.dataset.subject) return;
        resetToWelcome();
        showInterviewPanel(btn.dataset.subject);
    });
});

startInterviewBtn.addEventListener("click", startInterview);

recordBtn.addEventListener("click", () => {
    if (isSpeaking || recordBtn.disabled) return;
    
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
        startRecording();
    } else {
        stopRecording();
    }
});

submitBtn.addEventListener("click", submitAnswer);
endInterviewBtn.addEventListener("click", endInterview);
getFeedbackBtn.addEventListener("click", getFeedback);
newInterviewBtn.addEventListener("click", resetToWelcome);
