# Hollowfall: Meta-Game & Social Features Specification

This document outlines the architecture, design, and roadmap for "the rest of the owl"—the persistent metagame, social features, platform integrations, and advanced matchmaking systems that turn Hollowfall from a playable engine into a competitive, persistent "clubhouse."

## 1. Authentication & Unified Identity
To support a seamless experience across mobile (Google Play) and PC (Steam), we will implement a unified identity model.

### 1.1 Multi-Provider Login
* **Abstract Player Account**: At the core, we have a `PlayerAccount` in our database.
* **Linked Identities**: A player can have multiple `LinkedIdentities` associated with their account:
  * `google` (via Google OAuth2)
  * `steam` (via Steam OpenID/OAuth)
  * `guest` (temporary local device ID, allowing easy onboarding with an upgrade path to link a real account later).
* **Flow**:
  1. Client requests login via Google/Steam.
  2. Server validates the OAuth token / OpenID assertion with the respective platform.
  3. Server checks if the `providerId` exists. If so, log them into the associated `PlayerAccount`. If not, create a new `PlayerAccount`.
  4. Server issues a unified Hollowfall JWT to the client for subsequent authenticated requests.

## 2. Monetization (DLC & IAP)
Hollowfall will always be Free-to-Play. Monetization is strictly limited to **5 premium cosmetic emojis/classes**. These are the only premium items that will ever be sold. We must synchronize ownership of these items across platforms so a purchase on Steam is honored on mobile, and vice versa.

### 2.1 Steam Store Integration
* **Implementation**: We will configure the 5 premium items as DLC packages (AppIDs) tied to the base Free-to-Play game on Steam.
* **Verification**: When a user logs in via Steam, the server uses the Steamworks SDK / Web API (`CheckAppOwnership` or user entitlements) to verify which DLCs they own.
* **Unlocking**: The server updates the `PlayerAccount` to reflect the unlocked premium items.

### 2.2 Google Play Store Integration
* **Implementation**: We will configure the same 5 premium items as In-App Purchases (Managed Products, non-consumable) on the Google Play Console.
* **Verification**: When a user buys an item on their phone, the mobile client sends the purchase token to our server. The server uses the Google Play Developer API to verify the token.
* **Unlocking**: Once verified, the server flags the item as unlocked on the `PlayerAccount` and acknowledges the purchase with Google.

## 3. The "Clubhouse" (Landing Page UI/UX)
The main menu should not just be a static screen with a "Play" button. It should feel alive, showcasing the player's legacy and their friends' activity.

### 3.1 Layout & Experience
* **The Centerpiece**: The player's customized Avatar/Hearth. This could dynamically reflect their highest rank, favorite path (e.g., Ashwalk theme), or recently earned achievements.
* **The Ledger (Left Panel)**: 
  * **Player Stats**: Win/Loss ratio, total damage dealt, favorite spell paths, highest rank achieved.
  * **Match History & Replays**: A scrolling list of the last 10-20 matches. Clicking one loads the Replay.
* **The Network (Right Panel)**: 
  * **Friends List**: Integrated with Steam/Google Play social graphs where possible, plus in-game friend codes.
  * **Rich Presence**: Shows if a friend is "Online", "In Lobby", or "In Match (Turn 4) - [Spectate]".
* **The Arena (Action Bar - Bottom)**:
  * **Competitive (Blind 1v1)**: Big glowing button to queue up.
  * **Custom Match**: The existing lobby system for private games.
  * **2v2 (Future)**: Locked/Coming Soon.

## 4. Replays & Observer Mode
Because Hollowfall is built on a deterministic State Machine (FSM), replays and spectating are highly efficient.

### 4.1 Replays
* **Architecture**: We do not record video. We record the initial random seed, the starting game state, and an ordered list of all `Action` events dispatched during the game.
* **Storage**: These event logs are tiny (KB size) and can be saved to the database at the end of a match.
* **Playback**: The client downloads the event log, loads the initial state, and plays the events forward over time. We can easily build UI for "Play/Pause/Fast Forward".

### 4.2 Live Spectating (Observer Mode)
* **How it works**: When a player clicks "Spectate" on a friend, they connect to the game room via WebSockets as an `Observer`.
* **State Sync**: The server sends them the current snapshot of the game state, then streams live events as they happen.
* **Anti-Cheating**: The server must scrub the state sent to observers! The observer should **only** see the state their friend can see (their friend's hand), or if it's a tournament mode, we might have a delayed broadcast mode (e.g., 2-turn delay) that reveals all hands.

## 5. Matchmaking & Ranking
Currently, we have custom lobbies. We will build a competitive queue.

* **Matchmaking Service**: A simple Redis-backed queue or database polling system.
* **MMR (Matchmaking Rating)**: We will use a standard algorithm (like ELO or Glicko-2) to track player skill.
* **Flow**:
  1. Player clicks "Competitive 1v1".
  2. Client joins the queue pool, displaying "Searching for Opponent... Estimated Time: 0:30".
  3. Server matches two players within a reasonable MMR delta.
  4. Server provisions a new game room, sends a "Match Found" signal to both clients, and transitions them to the board.

## 6. Future Feature: 2v2 Mode Design Thoughts
As we plan for 2v2, we need to consider how the board and mechanics scale.
* **Board Size**: We likely need a larger maze/board configuration, or we use the existing board but it becomes much more crowded and chaotic (which could be fun!).
* **Turn Order**:
  * *Option A (Alternating)*: Team A Player 1 -> Team B Player 1 -> Team A Player 2 -> Team B Player 2.
  * *Option B (Simultaneous)*: Both players on a team take their turns at the same time. This is faster and great for mobile, but requires strict rules on action resolution.
* **Health & Objectives**: Do teams share a Hearth/Health pool, or do they have individual pools where if one player dies, the survivor fights 1v2? (Individual health is often more dramatic).
* **Friendly Fire**: In the spirit of chaotic games, friendly fire should probably be ON.

## 7. Development Roadmap (Agile Scope)
To tackle this without overwhelming the system, we should proceed in the following order:

1. **Phase 1a: Identity Foundation & JWT Auth**
   * Set up PostgreSQL schema for `PlayerAccounts` and `LinkedIdentities`.
   * Implement Google OAuth2 login flow on the server and client.
   * **JWT Architecture**:
     * Issue signed JSON Web Tokens containing the abstract `playerId`.
     * Store tokens securely on the client and pass them in the Socket.IO `auth` handshake.
     * Implement server-side Socket.IO middleware to cryptographically verify the token and attach the `playerId` to the socket, ensuring all game actions are securely attributed without relying on client claims.
2. **Phase 1b: Steam Store Integration & DLC**
   * Add Steam OpenID login and account linking.
   * Configure the 5 premium cosmetic emoji/classes as DLC on Steam.
   * Implement Steam API server-side entitlement checks to unlock classes in the DB.
3. **Phase 1c: Google Play Store Integration (IAP)**
   * Configure the 5 premium classes as Managed Products (non-consumable) in Google Play.
   * Implement server-side receipt validation with the Google Play Developer API.
4. **Phase 2: The Landing Page & Stats**
   * Build the "Clubhouse" UI.
   * Start tracking basic stats (Wins/Losses) at the end of existing custom matches.
5. **Phase 3: Matchmaking**
   * Build the Competitive Queue logic.
   * Implement basic ELO calculation post-match.
6. **Phase 4: Replays & Spectating**
   * Save event logs to the DB.
   * Build the Replay viewer UI.
   * Add the "Spectate Friend" WebSocket flow.
7. **Phase 5: 2v2**
   * Begin prototyping 2v2 rulesets.
