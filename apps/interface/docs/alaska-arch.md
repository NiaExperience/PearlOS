# Nia ↔ Native App (Thin-Client) Integration — High-Level Architecture

## Components

| Component | Responsibility |
|-----------|----------------|
| **User** | Speaks or types requests. |
| **Client App (iOS/Android/Xamarin)** | Streams audio/text to Nia; renders UI prompts; returns the user’s answers as *ActionResults*. |
| **Nia API** | ASR/TTS, dialog reasoning, policy checks, **and** all airline-API calls (search, cart, price, order). |
| **Airline API** | Standard REST/GraphQL endpoints exposed by the carrier or GDS. |

## End-to-End Flow

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant App as Client App
  participant Nia as Nia API
  participant Air as Airline API

  %% Voice / text in
  User ->> App: Speak / type request
  App  ->> Nia: Connect & stream audio (WS)

  %% Search flights
  Nia  ->> Air: search_flights(...)
  Air -->> Nia: Offer list

  %% Present options
  Nia  ->> App: present_options(offers)
  App  ->> User: Show list / voice summary
  User -->> App: Selects offer
  App  -->> Nia: ActionResult(selectedOffer)

  %% Booking loop (add pax, pet, infant, price, order)
  loop booking steps
      Nia  ->> Air: API call
      Air -->> Nia: Data
      Nia  ->> App: ask_question / request_form / confirm
      App  -->> User: Prompt
      User -->> App : Input / confirm
      App  -->> Nia : ActionResult
  end

  %% Finish
  Nia  ->> App: show_screen("TripDetails")
  App  ->> User: UI update / voice confirmation
```

## What the **Client Team** Has to Build

1. **Thin Nia Client** 
   *One WebSocket* to Nia (already provided as a NuGet/Swift Package).  
   - `startSession(token)`  
   - `onIntent(intentEnvelope) ⇒ ActionResult`

2. **UI Helpers**  
   | Intent | Suggested control |
   |--------|------------------|
   | `present_options` | `DisplayActionSheet` |
   | `ask_question` | `DisplayPromptAsync` |
   | `request_form` / `confirm` | Modal page or `DisplayAlert` |

3. **Deep-Link Handler**  
   If Nia emits `show_screen("TripDetails")`, handle `myapp://trip/details?orderRef=…`.
