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
    const context = this.app.messages.slice(-10);
    const sentence = this.generateSentence(bot, context);
    if (!sentence) {
      return;
    }

    const target = this.pickTarget(bot);
    this.app.addMessage({
      senderId: bot.id,
      targetId: target,
      text: sentence,
      attachment: null,
      attachmentSummary: ""
    });
  }

  pickTarget(bot) {
    const others = this.app.users.filter((u) => u.id !== bot.id);
    if (!others.length) {
      return "group";
    }
    const target = others[Math.floor(Math.random() * others.length)];
    return target.id;
  }

  generateSentence(bot, context) {
    const seeds = this.extractSeeds(context);
    const tone = bot.personality || "friendly";
    const openers = [
      "I keep thinking about",
      "Hot take:",
      "Random thought:",
      "No joke,",
      "I just noticed",
      "Tiny update:"
    ];
    const closers = [
      "what do you think?",
      "anyway that is my mood right now.",
      "I can expand if you want.",
      "someone respond before I overthink this.",
      "this is probably my personality talking.",
      "curious how everyone reads this."
    ];

    const seed = seeds.length ? seeds[Math.floor(Math.random() * seeds.length)] : "our group vibe";
    const opener = openers[Math.floor(Math.random() * openers.length)];
    const closer = closers[Math.floor(Math.random() * closers.length)];

    const styleHint = this.trimStyleHint(tone);
    const maybeMention = Math.random() < 0.4 ? this.randomMention(bot.id) : "";
    const base = `${opener} ${seed}.`; 
    const styleLine = styleHint ? ` ${styleHint}.` : "";
    const mentionLine = maybeMention ? ` ${maybeMention}` : "";
    return `${base}${styleLine}${mentionLine} ${closer}`.replace(/\s+/g, " ").trim();
  }

  randomMention(botId) {
    const candidates = this.app.users.filter((u) => u.id !== botId);
    if (!candidates.length) {
      return "";
    }
    const user = candidates[Math.floor(Math.random() * candidates.length)];
    return `@${user.name}`;
  }

  trimStyleHint(personality) {
    const clean = personality.trim();
    if (!clean) {
      return "";
    }
    return clean.length <= 60 ? `(${clean})` : `(${clean.slice(0, 57)}...)`;
  }

  extractSeeds(context) {
    const words = [];
    for (const msg of context) {
      const text = `${msg.text || ""} ${msg.attachmentSummary || ""}`.toLowerCase();
      const parts = text.match(/[a-z]{4,}/g) || [];
      for (const p of parts) {
        if (["that", "with", "have", "this", "from", "there", "about", "would"].includes(p)) {
          continue;
        }
        words.push(p);
      }
    }
    return words.slice(-30);
  }
}

class ChatApp {
  constructor() {
    this.users = [];
    this.messages = [];
    this.selectedBotId = null;
    this.pendingAttachment = null;

    this.ui = {
      usersList: document.getElementById("usersList"),
      chatMessages: document.getElementById("chatMessages"),
      sendAsSelect: document.getElementById("sendAsSelect"),
      targetSelect: document.getElementById("targetSelect"),
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
    const stored = localStorage.getItem("local-chat-text-state-v1");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        this.users = parsed.users.map((u) => new ChatUser(u));
        this.messages = parsed.messages.map((m) => new ChatMessage(m));
        return;
      } catch (_) {
        localStorage.removeItem("local-chat-text-state-v1");
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
    const targetId = this.ui.targetSelect.value || "group";
    const text = this.ui.messageInput.value.trim();

    if (!text && !this.pendingAttachment) {
      return;
    }

    this.addMessage({
      senderId,
      targetId,
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

    const targetOptions = ["<option value=\"group\">Group Chat</option>"]
      .concat(this.users.map((u) => `<option value="${u.id}">${u.name}</option>`))
      .join("");

    this.ui.sendAsSelect.innerHTML = allOptions;
    this.ui.targetSelect.innerHTML = targetOptions;
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
      const target = message.targetId && message.targetId !== "group"
        ? this.users.find((u) => u.id === message.targetId)?.name || "group"
        : "group";

      item.innerHTML = `
        <div class="message-head">
          <span>${sender.name} -> ${target}</span>
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
    localStorage.setItem("local-chat-text-state-v1", JSON.stringify(payload));
  }
}

window.addEventListener("DOMContentLoaded", () => {
  new ChatApp();
});
