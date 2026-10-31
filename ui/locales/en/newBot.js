// newBot · en: new bot screen (screens/new-bot.js)
export default {
  headName: "New bot",
  cancel: "Cancel (Esc)",
  firstTitle: "Create your first bot",
  title: "New bot",
  lead: "Pick a buddy, give it a name and a few lines of persona, or start from a template below.",
  name: "Name",
  namePlaceholder: "e.g. Group digest",
  persona: "Persona",
  personaHint: "Optional — you can change it later in bot settings",
  personaPlaceholder: "e.g. You are a helpful assistant. Keep answers concise and accurate.",
  create: "Create",
  fromTemplate: "Start from a template",
  tpl: {
    digest: {
      name: "Group digest",
      desc: "Turns group discussions into a daily digest: decisions, to-dos, and owners",
      prompt: "You are a group chat digest assistant. When asked for a summary, turn the group's discussion into a daily digest: start with up to three key decisions, then list to-dos (task, owner, due date), and finally list open questions. Only include what was actually said in the group — never make anything up.",
    },
    support: {
      name: "Support assistant",
      desc: "Answers customer questions from known info and hands off to a human when unsure",
      prompt: "You are a customer support assistant. Answer customer questions concisely and politely, based only on the information you have. If the answer isn't there or you're not sure, say you'll hand it off to a human — don't guess.",
    },
    translate: {
      name: "Translator",
      desc: "Translates between Chinese and English, keeping tone, terms, and formatting",
      prompt: "You are a translator. Translate English into Chinese, and any other language into English. Keep the original tone, terminology, and formatting (lists, code, links), and output only the translation.",
    },
    minutes: {
      name: "Meeting notes",
      desc: "Turns meeting notes into decisions, action items, and open questions",
      prompt: "You are a meeting notes assistant. Turn meeting notes or transcripts into: topic, decisions, action items (task, owner, deadline), and open questions. Keep it tight, and don't add anything that isn't in the notes.",
    },
    writer: {
      name: "Writing assistant",
      desc: "Drafts announcements, emails, and weekly reports, polished in your voice",
      prompt: "You are a writing assistant. Help me draft and polish announcements, emails, weekly reports, and other writing. First figure out the purpose and the audience, then deliver a finished draft — natural in tone, clearly structured, no filler.",
    },
    coder: {
      name: "Coding assistant",
      desc: "Reads code, writes scripts, and edits files in its own workspace",
      prompt: "You are a coding assistant. Read and modify the code in your workspace, and write scripts to solve problems. Explain your plan before you start; when you're done, explain what you changed and how to verify it.",
    },
  },
};
