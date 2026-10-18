# Her Motorsport — Official Discord Server Architecture & Configuration

This document specifies the complete setup, channel hierarchy, role permissions, and bot automation for the **Her Motorsport** Discord community.

---

## 1. Server Profile

- **Server Name:** `Her Motorsport`
- **Server Description:** `An inclusive, competitive sim racing paddock centering women and gender-diverse drivers across iRacing, Assetto Corsa, ACC, Le Mans Ultimate, and Automobilista 2.`
- **Server Icon:** `assets/img/discord-server-icon.png` (512×512 circular-safe shield emblem)
- **Community Enabled:** Yes (Enables Rules screening, Announcement channels, Forum channels, and Welcome Screen)
- **Default Notification Settings:** Mentions Only (to prevent notification fatigue)

---

## 2. Server Roles & Hierarchy

Configure roles in Discord Server Settings > Roles from highest to lowest:

| Role Name | Color | Key Permissions | Purpose |
| :--- | :--- | :--- | :--- |
| **👑 Race Control / Admin** | `#E74C3C` (Red) | Administrator | Server owners, lead stewards (`nanenj@gmail.com`) |
| **🛡️ Paddock Steward** | `#9B59B6` (Purple) | Manage Messages, Mute Members, View Audit Log | Incident reviews, race night marshaling |
| **🏎️ Driver Mentor** | `#3498DB` (Blue) | Mention @everyone in Coaching, Screen Share | Experienced racers offering setup & line guidance |
| **✨ Verified Driver** | `#2ECC71` (Green) | Attach Files, Embed Links, Use External Emoji | Drivers with confirmed website Paddock Pass |
| **🏁 Paddock Member** | `#BDC3C7` (Silver) | Send Messages, Read Message History, Connect Voice | Default role granted after accepting rules |
| **🎮 Sim: iRacing** | `#0078D7` | Cosmetic / Pingable | Opt-in role for iRacing event pings |
| **🎮 Sim: Assetto Corsa** | `#C0392B` | Cosmetic / Pingable | Opt-in role for AC event pings |
| **🎮 Sim: ACC** | `#E67E22` | Cosmetic / Pingable | Opt-in role for GT3/ACC event pings |
| **🎮 Sim: Le Mans Ultimate** | `#2980B9` | Cosmetic / Pingable | Opt-in role for WEC/LMU event pings |
| **🎮 Sim: Automobilista 2** | `#27AE60` | Cosmetic / Pingable | Opt-in role for AMS2 event pings |
| **🏆 Division: Spec Racing** | `#8E44AD` | Cosmetic / Pingable | Equal-car flagship championship drivers |
| **🏆 Division: Rookie Cup** | `#1ABC9C` | Cosmetic / Pingable | Novice sprint & coaching division drivers |
| **🏆 Division: Endurance** | `#D35400` | Cosmetic / Pingable | Multi-class and multi-driver team racers |

---

## 3. Channel Category & Permissions Layout

### 📌 CATEGORY: INFORMATION & ONBOARDING
*(Permissions: @everyone can Read; only Stewards can Write)*

- **`#rules-and-conduct`**
  - Full Code of Conduct aligned with iRacing Official Sporting Code (see Section 4 below).
- **`#announcements`** (Announcement Channel)
  - Official race notices, schedule shifts, server updates, and championship results.
- **`#roles-and-sims`**
  - Reaction-role buttons for selecting sims (`iRacing`, `AC`, `ACC`, `LMU`, `AMS2`) and divisions.
- **`#event-calendar`**
  - Read-only calendar feed synced directly with the website's Edge API.
- **`#website-sync`**
  - Link to register driver profiles and car numbers on [hermotorsport.com](https://hermotorsport.com).

---

### 💬 CATEGORY: THE PADDOCK
*(Permissions: All Members can Read & Send Messages)*

- **`#general-paddock`**
  - Casual chat, real-world motorsport, F1/WEC discussion, sim banter.
- **`#driver-introductions`**
  - Welcome area where new members introduce themselves, their sim gear, and favorite cars.
- **`#hardware-and-rigs`**
  - Wheels, pedals, cockpits, VR, triple screens, FOV calculations, troubleshooting.
- **`#driver-coaching`**
  - Lap analysis, braking marker tips, setup sharing, constructive critique.
- **`#screenshots-and-clips`**
  - Photo mode captures, battle highlights, race replay clips.
- **`#streamers-live`**
  - Automated webhook alerts when Her Motorsport drivers go live on Twitch or YouTube.

---

### 🏁 CATEGORY: COMPETITION & DIVISIONS
*(Permissions: All Members can Read & Discuss)*

- **`#spec-racing-division`**
  - Flagship equal-car championship: track guides, fixed setups, round discussions.
- **`#rookie-cup`**
  - Mentored sprints for newcomers: assist configurations, beginner questions.
- **`#endurance-and-teams`**
  - Team matchmaking, driver swaps, stint scheduling, fuel strategy.
- **`#race-briefings`**
  - Official server name, password, weather briefing, and timetable posted 2 hours before green flag.

---

### ⚖️ CATEGORY: RACE CONTROL & STEWARDING
*(Permissions: Private ticket threads; read-only bulletin)*

- **`#stewarding-standards`**
  - Explanation of overlap rule, defending lines, divebombs, and protest procedures.
- **`#incident-reports`**
  - Powered by Ticket Tool bot. Drivers click a button to open a private incident ticket with stewards to submit replay clips.
- **`#steward-bulletins`**
  - Official, calm public log of reviewed protests, penalty points, or racing incident rulings.

---

### 🔊 CATEGORY: VOICE COMMUNICATONS
*(Configured with Bitrate: 64kbps, Region: Automatic)*

- **`🎙️ Paddock Lounge`** (Unlimited) — Open casual voice chat.
- **`🏁 Race Comms 1`** (Limit 15) — Dedicated active race channel.
- **`🏁 Race Comms 2`** (Limit 15) — Overflow active race channel.
- **`🤝 1-on-1 Coaching`** (Limit 2) — Private screen-sharing and coaching.
- **`🤫 Radio Silence`** (Unlimited) — Muted room for drivers who prefer quiet racing.

---

## 4. Official Discord Paddock Rules

Copy and paste these exact rules into `#rules-and-conduct`:

```markdown
# 🏁 HER MOTORSPORT — PADDOCK RULES & RACING CODE

Welcome to Her Motorsport. We are an inclusive, fiercely competitive sim racing paddock centering women and gender-diverse racers. Our paddock is built on two pillars: welcoming camaraderie off the track, and hard, respectful competition on it.

### 1. RESPECT EVERYONE
- **Names & Pronouns:** Respect everyone's stated name and pronouns. Apologize and move forward if you slip.
- **Zero Tolerance:** No racism, sexism, homophobia, transphobia, ableism, or harassment in text, voice, or DMs. Violators are banned immediately.
- **Not a Dating App:** Unsolicited flirtatious or romantic attention is strictly forbidden.
- **No Gear Snobbery:** Whether someone drives on a desk clamp with a gamepad or a high-end motion chassis, all racers belong here.

### 2. HARD RACING, MUTUAL RESPECT (iRacing Standards)
We encourage hard, committed racing for position—that is what makes sim racing exciting. Racing on the limit means close battles:
- **Fight Fair:** Defend your position and challenge for corners. Reactionary blocking (moving in reaction to an overtaking car) and moving under braking are strictly prohibited.
- **Leave Racing Room:** When an overtaking car has established overlap before the turn-in point, leave a car's width of space on track.
- **Safe Rejoins:** If you spin or go off-track, hold your brakes until stationary. Never roll across the racing line into oncoming traffic. Check relative timings and rejoin parallel when clear.
- **Incidents Happen:** Close battles produce racing incidents. Never retaliate on track.

### 3. STEWARDING & DISPUTES
- **No Venting in Race Chat:** Do not yell, blame, or argue in voice comms or text channels during or immediately following a race.
- **File a Steward Ticket:** Submit incident clips calmly in `#incident-reports`. Every incident is reviewed impartially by our stewarding panel.
```

---

## 5. Recommended Bot Integrations

1. **Ticket Tool (`tickettool.xyz`)**
   - **Role:** Handles private stewarding tickets.
   - **Setup:** Create a panel in `#incident-reports` named "File Steward Review". Members click to open a private ticket visible only to them and the 👑 Race Control role.
2. **Carl-bot (`carl.gg`)**
   - **Role:** Reaction roles and automated moderation.
   - **Setup:** Run reaction role setup in `#roles-and-sims` to allow members to click emoji to claim `@iRacing`, `@ACC`, `@Assetto Corsa`, `@Le Mans Ultimate`, `@Automobilista 2`, and pronoun roles.
3. **Her Motorsport Edge Webhook (Custom)**
   - **Role:** Direct updates from `hermotorsport.com` to `#announcements` and `#event-calendar` when race times or schedule changes are made by Race Control.

---

## 6. Installed Skill & Ongoing Agent Maintenance

The **`discord-bot`** skill has been installed locally into Antigravity. When you provide Discord bot credentials (Bot Token or Webhook URL), the agent can:
- Post automatic race schedule reminders to `#event-calendar` 1 hour before lobbies open.
- Sync website driver roster registrations into `#paddock-pass-sync`.
- Update channel topics with current round information and weather briefings.
