// index.js - FPL Telegram Bot (Stable Final Version)
process.env.NODE_OPTIONS = '--openssl-legacy-provider';
require('dotenv').config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const cheerio = require("cheerio");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const cron = require("node-cron");
const { createCanvas } = require("canvas");

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const userLang = {};
const userTeams = {};
const priceSubscribers = new Set();
let playerData = [];

const fetchFPLData = async () => {
  const res = await axios.get("https://fantasy.premierleague.com/api/bootstrap-static/");
  playerData = res.data.elements;
};

const getLang = (chatId) => userLang[chatId] || "ar";

const translations = {
  ar: {
    welcome: "👋 أهلاً بك في بوت تحليل FPL!",
    tooShort: "⚠️ أرسل على الأقل 11 لاعب.",
    totalPoints: "📊 مجموع النقاط المتوقعة:",
    notFound: "❌ غير موجود",
    captain: "⭐ الكابتن المقترح:",
    vice: "🎯 نائب الكابتن:",
    langSet: "✅ تم تغيير اللغة إلى العربية",
    priceHeader: "📈 تغيّرات الأسعار المتوقعة الليلة:",
    rising: "🔼 سيرتفع السعر:",
    falling: "🔽 سينخفض السعر:",
    subscribed: "✅ سيتم إرسال تحديث تغيّرات الأسعار لك يوميًا في الليل.",
    noTeam: "🚫 لا يوجد فريق محفوظ لك.",
    yourTeam: "📋 فريقك الحالي:",
    suggestion: "🤖 التشكيلة المقترحة للجولة القادمة:",
  }
};

const doc = new GoogleSpreadsheet(process.env.SHEET_ID);

async function storeTeam(chatId, team) {
  try {
    await doc.useServiceAccountAuth({
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY,
    });
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle["Fpl"];
    await sheet.addRow({ chatId, timestamp: new Date().toISOString(), team: team.join(", ") });
  } catch (err) {
    console.error("Google Sheet Error:", err);
  }
}

bot.onText(/\/start/, (msg) => {
  const lang = getLang(msg.chat.id);
  bot.sendMessage(msg.chat.id, translations[lang].welcome);
});

bot.onText(/\/price/, async (msg) => {
  const chatId = msg.chat.id;
  const lang = getLang(chatId);
  priceSubscribers.add(chatId);
  bot.sendMessage(chatId, translations[lang].subscribed);
  sendPriceUpdate(chatId, lang);
});

bot.onText(/\/myteam/, (msg) => {
  const chatId = msg.chat.id;
  const lang = getLang(chatId);
  const team = userTeams[chatId];
  if (!team) {
    bot.sendMessage(chatId, translations[lang].noTeam);
  } else {
    // رسم صورة الفريق
    const canvas = createCanvas(600, 400);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#e6f0ff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    ctx.font = "bold 20px Arial";
    ctx.fillText(translations[lang].yourTeam, 20, 40);
    ctx.font = "16px Arial";
    team.forEach((name, i) => {
      ctx.fillText(`${i + 1}. ${name}`, 20, 70 + i * 25);
    });
    const image = canvas.toBuffer();
    bot.sendPhoto(chatId, image);
  }
});
const { createCanvas } = require("canvas");

bot.onText(/\/suggest/, async (msg) => {
  const chatId = msg.chat.id;
  const lang = getLang(chatId);

  try {
    await fetchFPLData();

    const bestPlayers = playerData
      .filter(p => parseFloat(p.ep_next) > 0)
      .sort((a, b) => parseFloat(b.ep_next) - parseFloat(a.ep_next))
      .slice(0, 11);

    if (!bestPlayers.length) {
      return bot.sendMessage(chatId, "❌ تعذر العثور على بيانات اللاعبين.");
    }

    let caption = `⚽️ التشكيلة المثالية المتوقعة:\n`;
    bestPlayers.forEach((p, i) => {
      caption += `${i + 1}. ${p.web_name} - ${parseFloat(p.ep_next).toFixed(1)} نقطة\n`;
    });

    // توليد صورة
    const canvas = createCanvas(600, 500);
    const ctx = canvas.getContext("2d");

    // خلفية بيضاء
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // عنوان
    ctx.fillStyle = "#000000";
    ctx.font = "bold 24px Arial";
    ctx.fillText("🏆 أفضل 11 لاعب للجولة القادمة", 100, 40);

    // أسماء اللاعبين
    ctx.font = "20px Arial";
    bestPlayers.forEach((p, i) => {
      ctx.fillText(`${i + 1}. ${p.web_name} - ${parseFloat(p.ep_next).toFixed(1)} pts`, 50, 80 + i * 35);
    });

    const buffer = canvas.toBuffer("image/png");
    bot.sendPhoto(chatId, buffer, { caption });
  } catch (err) {
    console.error("❌ Error in /suggest:", err);
    bot.sendMessage(chatId, "❌ حدث خطأ أثناء توليد التشكيلة.");
  }
});

bot.onText(/\/suggest/, async (msg) => {
  const lang = getLang(msg.chat.id);
  await fetchFPLData();
  const topPlayers = playerData
    .filter(p => p.ep_next && p.status === 'a')
    .sort((a, b) => parseFloat(b.ep_next) - parseFloat(a.ep_next))
    .slice(0, 11);

  const canvas = createCanvas(600, 400);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f0f0f0";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.font = "bold 20px Arial";
  ctx.fillText(translations[lang].suggestion, 20, 40);

  ctx.font = "16px Arial";
  topPlayers.forEach((p, i) => {
    ctx.fillText(`${i + 1}. ${p.web_name} (${parseFloat(p.ep_next).toFixed(1)} pts)`, 20, 70 + i * 25);
  });

  const imageBuffer = canvas.toBuffer();
  bot.sendPhoto(msg.chat.id, imageBuffer);
});

async function sendPriceUpdate(chatId, lang) {
  try {
    const res = await axios.get("https://fplstatistics.co.uk/PriceChanges");
    const $ = cheerio.load(res.data);
    const rows = $("#ismTable tbody tr");

    let rising = [], falling = [];

    rows.each((_, row) => {
      const cols = $(row).find("td");
      const name = $(cols[1]).text().trim();
      const change = $(cols[6]).text().trim().replace("%", "");
      const delta = parseFloat(change);
      const type = $(cols[4]).text().trim();

      if (type.toLowerCase().includes("up") && delta >= 90) rising.push(`${name} (${delta}%)`);
      if (type.toLowerCase().includes("down") && delta >= 80) falling.push(`${name} (${delta}%)`);
    });

    const msgText = [
      translations[lang].priceHeader,
      translations[lang].rising,
      rising.length ? rising.join("\n") : "—",
      translations[lang].falling,
      falling.length ? falling.join("\n") : "—"
    ].join("\n");

    bot.sendMessage(chatId, msgText);
  } catch (err) {
    bot.sendMessage(chatId, "❌ خطأ في جلب تغيّرات الأسعار.");
  }
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const lang = getLang(chatId);
  if (!text || typeof text !== 'string' || text.startsWith("/")) return;

  const players = text.split("\n").map(p => p.trim()).filter(Boolean);
  if (players.length < 11) return bot.sendMessage(chatId, translations[lang].tooShort);

  await fetchFPLData();
  userTeams[chatId] = players;
  await storeTeam(chatId, players);

  let total = 0;
  let responses = [];
  let captain = { name: "", points: 0 }, vice = { name: "", points: 0 };

  for (let name of players) {
    const p = playerData.find(p => `${p.first_name} ${p.second_name}`.toLowerCase().includes(name.toLowerCase()));
    if (!p) {
      responses.push(`${translations[lang].notFound} "${name}"`);
      continue;
    }
    const pts = parseFloat(p.ep_next) || 0;
    total += pts;
    if (pts > captain.points) {
      vice = { ...captain };
      captain = { name: p.web_name, points: pts };
    } else if (pts > vice.points) {
      vice = { name: p.web_name, points: pts };
    }
    responses.push(`✅ ${p.web_name} (${pts.toFixed(1)})`);
  }

  responses.push(`\n${translations[lang].captain} ${captain.name}`);
  responses.push(`${translations[lang].vice} ${vice.name}`);
  responses.push(`${translations[lang].totalPoints} ${total.toFixed(1)}`);
  bot.sendMessage(chatId, responses.join("\n"));
});

cron.schedule("0 22 * * *", () => {
  priceSubscribers.forEach(chatId => {
    const lang = getLang(chatId);
    sendPriceUpdate(chatId, lang);
  });
});
