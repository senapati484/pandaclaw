# 🤖 PandaClaw Telegram Bot Creation & Secure Device Pairing Plan

This document details the configuration requirements for creating the PandaClaw Telegram bot using BotFather, along with a secure, zero-config pairing protocol to bind your local machine/device with your Telegram account.

---

## 🔑 Part 1: BotFather Configuration Fields

To create and customize your Telegram Bot, search for [@BotFather](https://t.me/BotFather) on Telegram and execute the following configurations:

### 1. Bot Creation (`/newbot`)
*   **Command**: `/newbot`
*   **Name**: Choose a premium, human-readable name for your assistant.
    *   *Recommended Name*: `PandaClaw`
*   **Username**: Must end in `bot` or `_bot`. It must be globally unique.
    *   *Recommended Username*: `pandaclaw_bot` (or `yourname_pandaclaw_bot`)

### 2. Branding & Descriptions (Optional but Recommended)
*   **About Text** (`/setabouttext`): Visible on the bot's profile page.
    *   *Recommended Text*: `Deliberate, reasoning-first AI assistant in your pocket. Built on Bun & DeepSeek R1.`
*   **Description** (`/setdescription`): Visible when someone first opens a chat with the bot before clicking start.
    *   *Recommended Text*: `I am PandaClaw, your terminal-integrated personal AI swarm. Send me prompts to analyze code, search the web, execute safe scripts, or send photos of your screen to get direct visual support!`
*   **Profile Picture** (`/setuserpic`): Send a custom circular icon of a tech-savvy panda.

### 3. Menu Command Registry (`/setcommands`)
Pre-fill the menu commands for a highly professional user experience:
*   **Command**: `/setcommands`
*   **List**:
    ```text
    start - Wake up PandaClaw and check authorization status
    pair - Bind this Telegram chat with your local active device
    status - Check active workspace status, tracked files, and LLM providers
    help - Show commands syntax and help manual
    ```

---

## 🔒 Part 2: Secure Dynamic Device Pairing

To keep PandaClaw secure, it must only execute instructions coming from **your** authorized Telegram ID. Instead of forcing you to hunt down your numeric Telegram `chatId` manually and paste it into committed config files, we implement a **Dynamic Passkey Binding** scheme.

For security, paired user IDs are saved exclusively in a local, gitignored file (**`.pandaclaw/paired-users.json`**) so you never accidentally commit your Telegram account IDs to public repositories.

### 🔄 Pairing Architecture Diagram

```mermaid
sequenceDiagram
    participant User as 📱 Telegram App
    participant Local as 💻 Local Terminal (PandaClaw)
    participant Bot as 🤖 Telegram Bot API
    
    Local->>Local: Generate random passkey (e.g. 582-938)
    Local->>Local: Print pairing banner with passkey in Terminal
    User->>Bot: Open chat & click /start
    Bot->>User: "Send '/pair <passkey>' to bind your device"
    User->>Bot: Send: /pair 582-938
    Bot->>Local: Validate passkey
    Local->>Local: Match found! Save Telegram User ID in .pandaclaw/paired-users.json
    Local->>Bot: Success callback
    Bot->>User: "🎉 Device paired successfully! You are now authorized."
    Local->>Local: Render console alert: "✓ Paired with @username"
```

### 📋 Step-by-Step Pairing Protocol

1.  **Start Gateway**: Run the gateway from your local terminal:
    ```bash
    pandaclaw
    ```
    *(Choose Telegram gateway option)*
2.  **Generate & Print Passkey**:
    If no users are authorized yet on this device, the terminal generates a temporary 6-digit token (e.g. `582-938`) and holds it in volatile memory. It prints a beautiful, rounded purple pairing card:
    ```text
    ╭──────────────────────────────────────────────────────────╮
    │ 🐼 Pair your Telegram Bot                                │
    ├──────────────────────────────────────────────────────────┤
    │ 1. Open your bot: t.me/your_pandaclaw_bot                │
    │ 2. Send the following command to your bot:               │
    │    /pair 582-938                                         │
    ╰──────────────────────────────────────────────────────────╯
    ```
3.  **Send Authorization Command**:
    Open Telegram and message your bot: `/pair 582-938`.
4.  **Confirm and Save**:
    *   The bot validates the code.
    *   If correct, it appends your Telegram numeric `chatId` to the `users` list inside `.pandaclaw/paired-users.json`.
    *   Saves the config file back to your device local state instantly.
    *   The terminal prints: `✓ Device paired successfully with Telegram user @username (ID: 12345678)`.
    *   The bot replies on Telegram: `🎉 Connection established! Your device is now paired and secured.`

---

## 🛠️ Part 3: Implementation Strategy

PandaClaw implements pairing with maximum portability:

### 1. `modes/gateway/adapters/telegram.ts`
*   Maintains a local variable `pairingCode: string | null = null`.
*   Generates a pairing code on initialization if no users are in `config.json` allowed list or locally saved pairing list.
*   In the `"message"` listener, checks if the text starts with `/pair`.
*   Parses `/pair <code>`. Validates against `pairingCode`.
*   On successful match:
    1. Saves the numeric ID to the local **`.pandaclaw/paired-users.json`** file.
    2. Updates in-memory authorized lists.
    3. Return a success message and logs to console.

### 2. `.gitignore`
*   Explicitly ignores `.pandaclaw/paired-users.json` to keep device-local settings isolated and prevent committed token leaks.
