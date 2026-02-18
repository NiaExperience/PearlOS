import { Note } from '../types/notes-types';

export const WELCOME_NOTE_TITLE = 'A Note from Pearl';

export const getWelcomeNoteContent = (): Partial<Note> => ({
    title: WELCOME_NOTE_TITLE,
    content: `# A Note from Pearl

Welcome! 

Come on in and make yourself comfortable. This is your space for thinking, making, and connecting. I've written down some handy tips below for you. I prefer to talk with you but no pressure - we'll figure things out as we go!

~ Pearl

---

## 📝 Notes (Thinking Space) - YOU ARE HERE!
Here you can gather and actively explore thoughts the moment they come to you. You’re welcome to bring notes or files from other places to keep everything together. 

**Work Notes** — Shared with everyone in the Pearl community
**Personal Notes** — Just for you (say *"switch to personal notes"* anytime)

Notes can stay notes - or become something more!
### Try saying:
- *"Create a new note called Project Ideas"*
- *"Add a section about deadlines"*
- *"Replace ‘draft’ with ‘final’ in my note"*
- *"Download this note as a PDF"*
- *"Delete the old brainstorm note"*
- *"Show me my personal notes"*
- *"Create an app from this note"*


## 🎨 Studio (Creation Engine)
This is where ideas turn into things. Ask me to build interactive apps, games, and tools - no coding required!

### Some starter ideas for you:
- *"Turn my 'To Do Today' note into a game I can actually finish"*
- *"Make a retro arcade game based on Spacewar! with cats!"*
- *"Create an app to turn my syllabus into something less terrifying"*
- *"Build a 1980's graffiti wall that I can share with my friends for them to paint on"*
- *"Build a countdown timer app for my ‘I’ll just scroll for five minutes’ breaks"*
- *"Update my game to add a high score feature"*
- *"Roll back the app to the previous version"*

---

## 👥 Forum (Social Serendipity)
Whether it’s better together or your feeling like connecting, come to the Forum. This is a camera-on community space where I host conversations. Bring your friends or meet new ones. Humans only, no bots.

### To access this, tell me to:
- *"Open the forum"*
- *"Start a video call"*

---

## 🔗 Sharing & Collaboration
Helpful hint: you can share your notes and apps with others - and control their level of access.

### Use the button controls or just say things like:
- *"Share my Project Plan note with Amnah"*
- *"Give Luis edit access to my space invaders applet"*
- *"Make Mateo a viewer on this note"*
- *"Downgrade Kim to read-only"*


---

## 🎵 Soundtrack
I love the way music creates a little atmosphere! If you do too, you can play ambient background music that automatically quiets during conversation.

### Just say:
- *"Play some background music"*
- *"Stop the music"*
- *"Next track"*
- *"Turn the music down"*

---

## 📺 YouTube
You can search and play videos without leaving your workspace or headspace.

### Voice commands:
- *"Play some lo-fi beats"*
- *"Search YouTube for cooking tutorials"*
- *"Pause the video"*
- *"Play the next video"*

---

## 🖥️ Apps & Views
This space should feel how you need it to feel. Let me know when you're in a certain mood or if you need to access something - I'll get it for you.

### Some things you can tell me:
- *"Switch to work mode"*
- *"Switch to quiet mode"*
- *"Open YouTube"*
- *"Search Wikipedia for Albert Einstein"*
- *"Close all windows"*

---

## 🪟 Window Management
Helpful hint: I'm faster if you tell me how to manage your screen layout.

### Here are some starters for you:
- *"Minimize the window"*
- *"Maximize the window"*
- *"Snap the window to the left"*
- *"Snap the window to the right"*
- *"Reset window position"*

---

## 👤 Your Profile
Here's where you tell me what you want me to remember and ask me to forget anything you don’t. What you share here will personalize your experience and be used to introduce you to others.

### What you can do:
- *"I love hiking and photography"*
- *"I want to meet more people who are interested in calligraphy"*
- *"I prefer dark mode"*
- *"Forget my location information"*

---

## 💡 Reminders
- Say **"Hey Pearl"** or tap the mic to start talking to me. 
- I'm designed for with natural conversation. Just speak like you would to a friend
- Your personal notes are private; work notes are shared with everyone in our community
- Say **"goodbye"** or **"hang up"** when you're done

I'm glad you're here! Where do you want to start? 🚀`.trim(),
    mode: 'personal',
});
