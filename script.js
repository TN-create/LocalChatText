class ChatUser {
  constructor({ id, name, isBot, personality = "", bio = "", avatar = "", avatarSummary = "" }) {
    this.id = id;
    this.name = name;
    this.isBot = isBot;
    this.personality = personality;
    this.bio = bio;
    this.avatar = avatar;
    this.avatarSummary = avatarSummary;
  }
}

class ChatMessage {
  constructor({ id, senderId, targetId, text, attachment = null, attachmentSummary = "", timestamp }) {
    this.id = id;
    this.senderId = senderId;
    this.targetId = targetId;
    this.text = text;
    this.attachment = attachment;
    this.attachmentSummary = attachmentSummary;
    this.timestamp = timestamp;
  }
}

class ImageInterpreter {
  static async fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  static async summarizeDataUrl(dataUrl) {
    const img = await this.loadImage(dataUrl);
    const sample = this.readImageStats(img);
    const ratio = img.width / Math.max(1, img.height);
    const orientation = ratio > 1.25 ? "landscape" : ratio < 0.8 ? "portrait" : "square-ish";
    const vivid = sample.saturation > 0.4 ? "vivid" : "muted";
    const bright = sample.lightness > 0.62 ? "bright" : sample.lightness < 0.35 ? "dark" : "balanced";
    const motionHint = dataUrl.includes("image/gif") ? "animated-like visual" : "still image";
    return `${motionHint}, ${orientation}, ${vivid}, ${bright}, dominant tone ${sample.colorName}`;
  }

  static loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  static readImageStats(img) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const max = 32;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    canvas.width = Math.max(1, Math.floor(img.width * scale));
    canvas.height = Math.max(1, Math.floor(img.height * scale));
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 20) {
        continue;
      }
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n += 1;
    }

    if (!n) {
      return { saturation: 0, lightness: 0, colorName: "neutral gray" };
    }

    r /= n;
    g /= n;
    b /= n;

    const maxRGB = Math.max(r, g, b) / 255;
    const minRGB = Math.min(r, g, b) / 255;
    const lightness = (maxRGB + minRGB) / 2;
    const saturation = maxRGB === minRGB ? 0 : (maxRGB - minRGB) / (1 - Math.abs(2 * lightness - 1));

    return {
      saturation,
      lightness,
      colorName: this.nearestColorName(r, g, b)
    };
  }

  static nearestColorName(r, g, b) {
    const palette = [
      { name: "warm red", rgb: [196, 74, 51] },
      { name: "orange", rgb: [214, 136, 68] },
      { name: "gold", rgb: [206, 176, 79] },
      { name: "green", rgb: [81, 153, 86] },
      { name: "teal", rgb: [63, 153, 145] },
      { name: "blue", rgb: [74, 125, 196] },
      { name: "violet", rgb: [129, 94, 196] },
      { name: "pink", rgb: [196, 104, 154] },
      { name: "brown", rgb: [125, 95, 68] },
      { name: "neutral gray", rgb: [140, 140, 140] }
    ];

    let best = palette[0].name;
    let bestScore = Infinity;
    for (const swatch of palette) {
      const dr = r - swatch.rgb[0];
      const dg = g - swatch.rgb[1];
      const db = b - swatch.rgb[2];
      const score = dr * dr + dg * dg + db * db;
      if (score < bestScore) {
        bestScore = score;
        best = swatch.name;
      }
    }
    return best;
  }
}

class BotDirector {
  constructor(app) {
    this.app = app;
    this.botEnabled = true;
    this.timer = null;
    this.botMemory = new Map();
  }

  start() {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      if (!this.botEnabled) {
        return;
      }
      this.tick();
    }, 1800);
  }

  stop() {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    const bots = this.app.users.filter((u) => u.isBot);
    if (!bots.length) {
      return;
    }

    const activeChance = Math.random();
    if (activeChance < 0.35) {
      return;
    }

    const bot = bots[Math.floor(Math.random() * bots.length)];
    const context = this.app.messages.slice(-18);
    const sentence = this.generateSentence(bot, context);
    if (!sentence) {
      return;
    }

    this.app.addMessage({
      senderId: bot.id,
      targetId: "group",
      text: sentence,
      attachment: null,
      attachmentSummary: ""
    });
  }

  generateSentence(bot, context) {
    const topicWords = this.extractTopicWords(context, bot.id);
    const lastMessage = this.pickRecentExternalMessage(context, bot.id);
    const profile = this.profileFor(bot);

    for (let i = 0; i < 6; i += 1) {
      const line = this.buildLine(bot, profile, topicWords, lastMessage).replace(/\s+/g, " ").trim();
      if (!line) {
        continue;
      }
      if (!this.isRecentDuplicate(bot.id, line)) {
        this.remember(bot.id, line);
        return line;
      }
    }

    return "I am still here and following the thread.";
  }

  profileFor(bot) {
    const p = `${bot.personality || ""} ${bot.bio || ""}`.toLowerCase();
    return {
      concise: p.includes("short") || p.includes("punchy"),
      humor: p.includes("humor") || p.includes("sarcasm") || p.includes("joke"),
      analytical: p.includes("detail") || p.includes("calm") || p.includes("nerd") || p.includes("ground"),
      energetic: p.includes("energetic") || p.includes("fast") || p.includes("trend")
    };
  }

  buildLine(bot, profile, topicWords, lastMessage) {
    const topic = topicWords.length
      ? topicWords[Math.floor(Math.random() * topicWords.length)]
      : "the current thread";
    const secondTopic = topicWords.length > 1
      ? topicWords[Math.floor(Math.random() * topicWords.length)]
      : "it";
    const mention = Math.random() < 0.28 ? this.randomMention(bot.id) : "";
    const mode = this.pickMode(profile);

    if (mode === "question") {
      return this.withMention(
        mention,
        this.pick([
          `What are we optimizing around ${topic}?`,
          `Do we want to keep ${topic} simple or make it richer?`,
          `Does anyone else think ${topic} connects to ${secondTopic}?`,
          `Would you ship this approach to ${topic} as-is?`
        ])
      );
    }

    if (mode === "reaction" && lastMessage) {
      const sourceName = this.app.users.find((u) => u.id === lastMessage.senderId)?.name || "someone";
      const phrase = this.cleanSnippet(lastMessage.text || "");
      const imageAngle = lastMessage.attachmentSummary
        ? ` Also, the image details sounded ${this.summarizeImageMood(lastMessage.attachmentSummary)}.`
        : "";
      return this.withMention(
        mention,
        this.pick([
          `${sourceName} raised a good point on ${phrase || topic}; we can tighten that idea.${imageAngle}`,
          `I agree with ${sourceName} on ${topic}, especially if we keep ${secondTopic} practical.${imageAngle}`,
          `${sourceName}'s message about ${phrase || topic} feels right, but I would simplify the next step.${imageAngle}`
        ])
      );
    }

    if (mode === "humor") {
      return this.withMention(
        mention,
        this.pick([
          `I vote we stop overthinking ${topic} and just test it in the chat flow.`,
          `${topic} is winning the conversation today, and I respect the chaos.`,
          `If ${topic} had a fan club in here, half of us already joined.`
        ])
      );
    }

    if (mode === "analytical") {
      return this.withMention(
        mention,
        this.pick([
          `For ${topic}, I would split the problem into input, output, and validation.`,
          `A reliable path for ${topic} is to keep state local and deterministic.`,
          `The key tradeoff around ${topic} is speed versus clarity in the thread.`
        ])
      );
    }

    return this.withMention(
      mention,
      this.pick([
        `Quick thought: ${topic} can work better if we connect it with ${secondTopic}.`,
        `I am following the thread, and ${topic} still feels like the center of it.`,
        `We are close here; ${topic} just needs one more clear pass.`
      ])
    );
  }

  pickMode(profile) {
    const pool = ["general", "question", "reaction"];
    if (profile.humor) {
      pool.push("humor");
    }
    if (profile.analytical) {
      pool.push("analytical");
    }
    if (profile.energetic) {
      pool.push("question", "general");
    }
    if (profile.concise) {
      pool.push("humor", "question");
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }

  withMention(mention, text) {
    if (!mention) {
      return text;
    }
    return `${mention} ${text}`;
  }

  randomMention(botId) {
    const candidates = this.app.users.filter((u) => u.id !== botId);
    if (!candidates.length) {
      return "";
    }
    const user = candidates[Math.floor(Math.random() * candidates.length)];
    return `@${user.name}`;
  }

  pickRecentExternalMessage(context, botId) {
    const candidates = context.filter((m) => m.senderId !== botId);
    return candidates.length ? candidates[candidates.length - 1] : null;
  }

  summarizeImageMood(summary) {
    const s = summary.toLowerCase();
    if (s.includes("vivid")) {
      return "vivid and attention-grabbing";
    }
    if (s.includes("dark")) {
      return "moody and low-light";
    }
    if (s.includes("bright")) {
      return "bright and upbeat";
    }
    return "balanced";
  }

  cleanSnippet(text) {
    const words = (text || "").toLowerCase().match(/[a-z]{4,}/g) || [];
    const filtered = words.filter((w) => !this.stopWords().has(w));
    if (!filtered.length) {
      return "the thread";
    }
    return filtered.slice(0, 4).join(" ");
  }

  extractTopicWords(context, botId) {
    const bag = [];
    for (const msg of context) {
      if (msg.senderId === botId) {
        continue;
      }
      const text = `${msg.text || ""} ${msg.attachmentSummary || ""}`.toLowerCase();
      const words = text.match(/[a-z]{4,}/g) || [];
      for (const w of words) {
        if (this.stopWords().has(w)) {
          continue;
        }
        bag.push(w);
      }
    }
    const scored = this.rankWords(bag);
    return scored.slice(0, 18);
  }

  rankWords(words) {
    const count = new Map();
    for (const w of words) {
      count.set(w, (count.get(w) || 0) + 1);
    }
    return [...count.entries()]
      .sort((a, b) => b[1] - a[1])
      .map((entry) => entry[0]);
  }

  stopWords() {
    return new Set([
      "that", "with", "have", "this", "from", "there", "about", "would", "their", "could", "should",
      "what", "when", "where", "which", "will", "just", "into", "then", "than", "they", "them", "your",
      "you", "ours", "ourselves", "really", "also", "already", "very", "much", "make", "made", "been",
      "being", "here", "over", "under", "still", "some", "more", "most", "only", "group", "chat", "readout"
    ]);
  }

  pick(options) {
    return options[Math.floor(Math.random() * options.length)];
  }

  isRecentDuplicate(botId, line) {
    const memory = this.botMemory.get(botId) || [];
    const normalized = line.toLowerCase();
    return memory.some((m) => m === normalized);
  }

  remember(botId, line) {
    const memory = this.botMemory.get(botId) || [];
    memory.push(line.toLowerCase());
    if (memory.length > 20) {
      memory.shift();
    }
    this.botMemory.set(botId, memory);
  }
}

class ChatApp {
  constructor() {
    this.stateKey = "local-chat-text-state-v2";
    this.users = [];
    this.messages = [];
    this.selectedBotId = null;
    this.pendingAttachment = null;

    this.ui = {
      usersList: document.getElementById("usersList"),
      chatMessages: document.getElementById("chatMessages"),
      sendAsSelect: document.getElementById("sendAsSelect"),
      messageInput: document.getElementById("messageInput"),
      sendBtn: document.getElementById("sendBtn"),
      attachBtn: document.getElementById("attachBtn"),
      attachmentInput: document.getElementById("attachmentInput"),
      attachmentPreview: document.getElementById("attachmentPreview"),
      addBotBtn: document.getElementById("addBotBtn"),
      editorEmpty: document.getElementById("editorEmpty"),
      editorForm: document.getElementById("userEditorForm"),
      editName: document.getElementById("editName"),
      editPersonality: document.getElementById("editPersonality"),
      editBio: document.getElementById("editBio"),
      editAvatar: document.getElementById("editAvatar"),
      avatarSummary: document.getElementById("avatarSummary"),
      deleteBotBtn: document.getElementById("deleteBotBtn"),
      toggleBotsBtn: document.getElementById("toggleBotsBtn"),
      statusText: document.getElementById("statusText")
    };

    this.botDirector = new BotDirector(this);
    this.seedDefaults();
    this.bindEvents();
    this.renderAll();
    this.botDirector.start();
  }

  seedDefaults() {
    const stored = localStorage.getItem(this.stateKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        this.users = parsed.users.map((u) => new ChatUser(u));
        this.messages = parsed.messages.map((m) => new ChatMessage(m));
        this.messages = this.messages.map((m) => {
          m.targetId = "group";
          return m;
        });
        return;
      } catch (_) {
        localStorage.removeItem(this.stateKey);
      }
    }

    this.users = [
      new ChatUser({
        id: "main-user",
        name: "You",
        isBot: false,
        personality: "Main user",
        bio: "Controller of the simulation"
      }),
      new ChatUser({
        id: "bot-1",
        name: "Mina",
        isBot: true,
        personality: "energetic trend watcher",
        bio: "Talks fast and asks follow-up questions"
      }),
      new ChatUser({
        id: "bot-2",
        name: "Rafi",
        isBot: true,
        personality: "calm detail nerd",
        bio: "Usually grounds the conversation"
      }),
      new ChatUser({
        id: "bot-3",
        name: "Nox",
        isBot: true,
        personality: "dry humor and sarcasm",
        bio: "Makes short, punchy replies"
      })
    ];

    this.messages = [
      new ChatMessage({
        id: crypto.randomUUID(),
        senderId: "bot-1",
        targetId: "group",
        text: "Welcome to the simulation. I am already mid-conversation.",
        timestamp: Date.now()
      }),
      new ChatMessage({
        id: crypto.randomUUID(),
        senderId: "bot-2",
        targetId: "group",
        text: "I am tracking context from messages and image summaries locally.",
        timestamp: Date.now()
      })
    ];
  }

  bindEvents() {
    this.ui.sendBtn.addEventListener("click", () => this.handleSend());
    this.ui.messageInput.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        this.handleSend();
      }
    });

    this.ui.attachBtn.addEventListener("click", () => this.ui.attachmentInput.click());
    this.ui.attachmentInput.addEventListener("change", (event) => this.handleAttachment(event));

    this.ui.addBotBtn.addEventListener("click", () => this.addBot());
    this.ui.editorForm.addEventListener("submit", (event) => {
      event.preventDefault();
      this.saveSelectedBotEdits();
    });
    this.ui.deleteBotBtn.addEventListener("click", () => this.deleteSelectedBot());
    this.ui.editAvatar.addEventListener("change", (event) => this.handleAvatarChange(event));

    this.ui.toggleBotsBtn.addEventListener("click", () => {
      this.botDirector.botEnabled = !this.botDirector.botEnabled;
      this.ui.toggleBotsBtn.textContent = this.botDirector.botEnabled ? "Pause Bots" : "Resume Bots";
      this.ui.statusText.textContent = this.botDirector.botEnabled
        ? "Bots are thinking..."
        : "Bots paused by main user.";
    });
  }

  async handleAttachment(event) {
    const [file] = event.target.files || [];
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/") && file.type !== "image/gif") {
      alert("Only images or GIF files are allowed.");
      return;
    }

    const dataUrl = await ImageInterpreter.fileToDataUrl(file);
    const summary = await ImageInterpreter.summarizeDataUrl(dataUrl);
    this.pendingAttachment = { dataUrl, summary, name: file.name };
    this.renderAttachmentPreview();
  }

  renderAttachmentPreview() {
    if (!this.pendingAttachment) {
      this.ui.attachmentPreview.classList.add("hidden");
      this.ui.attachmentPreview.innerHTML = "";
      return;
    }

    this.ui.attachmentPreview.classList.remove("hidden");
    this.ui.attachmentPreview.innerHTML = `
      <span><strong>Attached:</strong> ${this.pendingAttachment.name} | ${this.pendingAttachment.summary}</span>
      <button id="clearAttachmentBtn" class="btn" type="button">Remove</button>
    `;

    const clearBtn = document.getElementById("clearAttachmentBtn");
    clearBtn.addEventListener("click", () => {
      this.pendingAttachment = null;
      this.ui.attachmentInput.value = "";
      this.renderAttachmentPreview();
    });
  }

  addBot() {
    const next = this.users.filter((u) => u.isBot).length + 1;
    const bot = new ChatUser({
      id: `bot-${Date.now()}`,
      name: `Bot${next}`,
      isBot: true,
      personality: "adaptable and chatty",
      bio: "Freshly generated fake user"
    });
    this.users.push(bot);
    this.selectedBotId = bot.id;
    this.renderAll();
    this.saveState();
  }

  getSelectedBot() {
    return this.users.find((u) => u.id === this.selectedBotId && u.isBot) || null;
  }

  selectBot(botId) {
    this.selectedBotId = botId;
    this.renderUsers();
    this.renderEditor();
  }

  async handleAvatarChange(event) {
    const selected = this.getSelectedBot();
    if (!selected) {
      return;
    }

    const [file] = event.target.files || [];
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      alert("Profile picture must be an image.");
      return;
    }

    selected.avatar = await ImageInterpreter.fileToDataUrl(file);
    selected.avatarSummary = await ImageInterpreter.summarizeDataUrl(selected.avatar);
    this.ui.avatarSummary.textContent = `Avatar readout: ${selected.avatarSummary}`;
    this.renderUsers();
    this.renderComposerOptions();
    this.saveState();
  }

  saveSelectedBotEdits() {
    const selected = this.getSelectedBot();
    if (!selected) {
      return;
    }

    selected.name = this.ui.editName.value.trim() || selected.name;
    selected.personality = this.ui.editPersonality.value.trim();
    selected.bio = this.ui.editBio.value.trim();
    this.renderAll();
    this.saveState();
  }

  deleteSelectedBot() {
    const selected = this.getSelectedBot();
    if (!selected) {
      return;
    }

    const keepUsers = this.users.filter((u) => u.id !== selected.id);
    this.users = keepUsers;
    this.messages = this.messages.filter((m) => m.senderId !== selected.id);
    this.selectedBotId = null;
    this.renderAll();
    this.saveState();
  }

  addMessage({ senderId, targetId, text, attachment, attachmentSummary }) {
    const message = new ChatMessage({
      id: crypto.randomUUID(),
      senderId,
      targetId,
      text,
      attachment,
      attachmentSummary,
      timestamp: Date.now()
    });
    this.messages.push(message);
    if (this.messages.length > 350) {
      this.messages = this.messages.slice(-350);
    }
    this.renderMessages();
    this.saveState();
  }

  handleSend() {
    const senderId = this.ui.sendAsSelect.value;
    const text = this.ui.messageInput.value.trim();

    if (!text && !this.pendingAttachment) {
      return;
    }

    this.addMessage({
      senderId,
      targetId: "group",
      text,
      attachment: this.pendingAttachment ? this.pendingAttachment.dataUrl : null,
      attachmentSummary: this.pendingAttachment ? this.pendingAttachment.summary : ""
    });

    this.ui.messageInput.value = "";
    this.pendingAttachment = null;
    this.ui.attachmentInput.value = "";
    this.renderAttachmentPreview();
  }

  renderAll() {
    this.renderUsers();
    this.renderEditor();
    this.renderComposerOptions();
    this.renderMessages();
  }

  renderUsers() {
    this.ui.usersList.innerHTML = "";

    for (const user of this.users) {
      const li = document.createElement("li");
      li.className = `user-item ${user.id === this.selectedBotId ? "active" : ""}`;
      if (user.isBot) {
        li.addEventListener("click", () => this.selectBot(user.id));
      }

      li.innerHTML = `
        <img class="avatar" src="${user.avatar || this.defaultAvatar(user.name)}" alt="${user.name} avatar" />
        <div class="user-meta">
          <span class="user-name">${user.name}</span>
          <span class="user-role">${user.isBot ? "Fake AI user" : "Main user"}</span>
        </div>
      `;
      this.ui.usersList.appendChild(li);
    }
  }

  renderEditor() {
    const selected = this.getSelectedBot();
    if (!selected) {
      this.ui.editorEmpty.classList.remove("hidden");
      this.ui.editorForm.classList.add("hidden");
      this.ui.avatarSummary.textContent = "";
      return;
    }

    this.ui.editorEmpty.classList.add("hidden");
    this.ui.editorForm.classList.remove("hidden");
    this.ui.editName.value = selected.name;
    this.ui.editPersonality.value = selected.personality;
    this.ui.editBio.value = selected.bio;
    this.ui.avatarSummary.textContent = selected.avatarSummary
      ? `Avatar readout: ${selected.avatarSummary}`
      : "No avatar analyzed yet.";
  }

  renderComposerOptions() {
    const allOptions = this.users
      .map((u) => `<option value="${u.id}">${u.name}${u.isBot ? " (Fake AI)" : " (Main)"}</option>`)
      .join("");

    this.ui.sendAsSelect.innerHTML = allOptions;
    if (![...this.ui.sendAsSelect.options].some((o) => o.value === this.ui.sendAsSelect.value)) {
      this.ui.sendAsSelect.value = "main-user";
    }
  }

  renderMessages() {
    this.ui.chatMessages.innerHTML = "";

    for (const message of this.messages) {
      const sender = this.users.find((u) => u.id === message.senderId);
      if (!sender) {
        continue;
      }

      const isSelf = message.senderId === "main-user";
      const item = document.createElement("article");
      item.className = `message ${isSelf ? "self" : ""}`;

      const time = new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      item.innerHTML = `
        <div class="message-head">
          <span>${sender.name}</span>
          <span>${time}</span>
        </div>
        <div class="message-body">${this.escapeHtml(message.text || "")}</div>
        ${message.attachment ? `<img class="message-attachment" src="${message.attachment}" alt="attachment" />` : ""}
        ${message.attachmentSummary ? `<div class="attachment-note">AI image readout: ${message.attachmentSummary}</div>` : ""}
      `;

      this.ui.chatMessages.appendChild(item);
    }

    this.ui.chatMessages.scrollTop = this.ui.chatMessages.scrollHeight;
  }

  escapeHtml(text) {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  defaultAvatar(seed) {
    const bg = this.hashColor(seed);
    const label = encodeURIComponent(seed.slice(0, 1).toUpperCase());
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='60' height='60'><rect width='100%' height='100%' fill='${bg}'/><text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' fill='white' font-size='28' font-family='sans-serif'>${label}</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  hashColor(seed) {
    let h = 0;
    for (let i = 0; i < seed.length; i += 1) {
      h = seed.charCodeAt(i) + ((h << 5) - h);
      h |= 0;
    }
    const hue = Math.abs(h) % 360;
    return `hsl(${hue} 56% 52%)`;
  }

  saveState() {
    const payload = {
      users: this.users,
      messages: this.messages
    };
    localStorage.setItem(this.stateKey, JSON.stringify(payload));
  }
}

window.addEventListener("DOMContentLoaded", () => {
  new ChatApp();
});
