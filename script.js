/* DOM elements */
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");
const resetMemoryBtn = document.getElementById("resetMemoryBtn");

// Keep the conversation focused on L'Oréal products, routines, and recommendations.
const systemPrompt =
  "You are a L'Oréal beauty advisor. Only answer questions about L'Oréal products, beauty routines, skincare, haircare, makeup, fragrances, and product recommendations. If the user asks about anything unrelated, politely refuse and say you can only help with L'Oréal-related beauty topics. Do not answer general knowledge, coding, news, politics, weather, or other off-topic questions. Always redirect the user back to L'Oréal products or beauty routines. Use conversation context, including the user's name and recent questions, to provide natural multi-turn replies. Keep replies clear, concise, and helpful.";

// Cloudflare Worker endpoint that forwards requests to OpenAI securely.
const workerUrl = "https://loral-worker.mabanyi.workers.dev/";

// localStorage key for saved conversation memory.
const memoryStorageKey = "lorealChatMemory";

// Store the chat history that will be sent to OpenAI.
const messages = [{ role: "system", content: systemPrompt }];

// Store important conversation details for better multi-turn context.
const conversationMemory = {
  userName: "",
  pastQuestions: [],
};

function saveConversationMemory() {
  localStorage.setItem(memoryStorageKey, JSON.stringify(conversationMemory));
}

function resetConversationMemory() {
  conversationMemory.userName = "";
  conversationMemory.pastQuestions = [];
  localStorage.removeItem(memoryStorageKey);
}

function loadConversationMemory() {
  const storedMemory = localStorage.getItem(memoryStorageKey);

  if (!storedMemory) {
    return;
  }

  try {
    const parsedMemory = JSON.parse(storedMemory);

    if (typeof parsedMemory.userName === "string") {
      conversationMemory.userName = parsedMemory.userName;
    }

    if (Array.isArray(parsedMemory.pastQuestions)) {
      conversationMemory.pastQuestions = parsedMemory.pastQuestions
        .filter((question) => typeof question === "string")
        .slice(-8);
    }
  } catch (error) {
    localStorage.removeItem(memoryStorageKey);
  }
}

// Try to extract a name from common user introductions.
function extractUserName(text) {
  const patterns = [
    /my name is\s+([a-z][a-z'\-]+)/i,
    /i am\s+([a-z][a-z'\-]+)/i,
    /i'm\s+([a-z][a-z'\-]+)/i,
    /call me\s+([a-z][a-z'\-]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match) {
      const name = match[1].trim();
      return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
    }
  }

  return "";
}

function updateConversationMemory(userMessage) {
  const detectedName = extractUserName(userMessage);

  if (detectedName) {
    conversationMemory.userName = detectedName;
  }

  conversationMemory.pastQuestions.push(userMessage);

  // Keep only the latest 8 user turns in memory.
  if (conversationMemory.pastQuestions.length > 8) {
    conversationMemory.pastQuestions.shift();
  }

  saveConversationMemory();
}

function buildContextMessage() {
  const lines = ["Conversation context:"];

  if (conversationMemory.userName) {
    lines.push(`User name: ${conversationMemory.userName}`);
  } else {
    lines.push("User name: unknown");
  }

  if (conversationMemory.pastQuestions.length > 0) {
    lines.push("Recent user questions:");
    conversationMemory.pastQuestions.forEach((question, index) => {
      lines.push(`${index + 1}. ${question}`);
    });
  }

  return lines.join("\n");
}

// Render one chat message as a styled bubble.
function addMessage(text, type) {
  const message = document.createElement("div");
  message.className = `msg ${type}`;
  message.textContent = text;
  chatWindow.appendChild(message);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return message;
}

// Show the latest user question right above the current assistant response.
function showLatestQuestion(questionText) {
  const previousQuestion = chatWindow.querySelector(".latest-question");

  if (previousQuestion) {
    previousQuestion.remove();
  }

  const latestQuestion = document.createElement("div");
  latestQuestion.className = "latest-question";
  latestQuestion.textContent = `Latest question: ${questionText}`;
  chatWindow.appendChild(latestQuestion);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

resetMemoryBtn.addEventListener("click", () => {
  resetConversationMemory();

  const previousQuestion = chatWindow.querySelector(".latest-question");
  if (previousQuestion) {
    previousQuestion.remove();
  }

  addMessage(
    "Chat memory was reset. You can share your name and preferences again.",
    "ai",
  );
});

// Set the initial assistant message.
loadConversationMemory();

if (conversationMemory.userName) {
  addMessage(
    `Welcome back, ${conversationMemory.userName}! Ask me about L'Oréal products, routines, recommendations, or beauty care.`,
    "ai",
  );
} else {
  addMessage(
    "Hello! Ask me about L'Oréal products, routines, recommendations, or beauty care.",
    "ai",
  );
}

// Send a request to the Cloudflare Worker endpoint.
async function getChatbotReply(requestMessages) {
  const response = await fetch(workerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: requestMessages,
    }),
  });

  if (!response.ok) {
    throw new Error("Cloudflare Worker request failed.");
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error.message || "Worker returned an API error.");
  }

  return data.choices[0].message.content;
}

/* Handle form submit */
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const userMessage = userInput.value.trim();

  if (!userMessage) {
    return;
  }

  // Show the user's message immediately.
  addMessage(userMessage, "user");
  updateConversationMemory(userMessage);
  messages.push({ role: "user", content: userMessage });

  userInput.value = "";
  chatForm.querySelector("button").disabled = true;

  // Show a temporary assistant message while the API request is in progress.
  showLatestQuestion(userMessage);
  const loadingMessage = addMessage("Thinking...", "ai");

  (async () => {
    try {
      const requestMessages = [
        ...messages,
        { role: "system", content: buildContextMessage() },
      ];

      const assistantReply = await getChatbotReply(requestMessages);
      loadingMessage.textContent = assistantReply;
      messages.push({ role: "assistant", content: assistantReply });
    } catch (error) {
      loadingMessage.textContent =
        "Sorry, I could not get a response right now. Please try again.";
    } finally {
      chatForm.querySelector("button").disabled = false;
      userInput.focus();
    }
  })();
});
