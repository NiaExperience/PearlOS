# Nia Universal - Complete Setup Guide

> **A simple, step-by-step guide to get Nia Universal running on your computer**

This guide will help you install and run Nia Universal on **Windows**, **Linux**, or **Mac**. No technical experience needed - we'll explain everything in simple terms!

---

## 📋 What You Need Before Starting

Before we begin, you need to have these programs installed on your computer:

| Program | What It Does | How to Check If You Have It |
|---------|--------------|----------------------------|
| **Node.js** | Runs JavaScript code (the project is built with this) | Open terminal/command prompt and type: `node --version` |
| **npm** | Installs project files (comes with Node.js) | Type: `npm --version` |
| **Git** | Downloads the project code | Type: `git --version` |
| **PostgreSQL** | Stores data (like a digital filing cabinet) | Type: `psql --version` |
| **Docker** (Optional) | Makes it easier to run PostgreSQL | Type: `docker --version` |

**You need Node.js version 20 or higher, and npm version 10 or higher.**

---

## 🪟 Windows Setup

### Step 1: Install Required Programs

#### Install Node.js
1. Go to https://nodejs.org/
2. Download the **LTS version** (the green button)
3. Run the installer and click "Next" through all the steps
4. **Important:** Make sure "Add to PATH" is checked during installation
5. Restart your computer after installation

#### Install Git
1. Go to https://git-scm.com/download/win
2. Download and run the installer
3. Use all the default settings (just keep clicking "Next")

#### Install PostgreSQL (Choose One Option)

**Option A: Using Docker (Easier)**
1. Download Docker Desktop: https://docs.docker.com/desktop/install/windows-install/
2. Install and start Docker Desktop
3. You're done! We'll use Docker to run PostgreSQL later

**Option B: Install PostgreSQL Directly**
1. Go to https://www.postgresql.org/download/windows/
2. Download the installer
3. During installation, remember the password you set for the `postgres` user (you'll need it later)
4. Use the default port (5432)

#### Install Python (for voice features)
1. Go to https://www.python.org/downloads/
2. Download Python 3.11 or newer
3. **Important:** Check "Add Python to PATH" during installation

### Step 2: Get the Project Code

1. Open **Git Bash** (search for "Git Bash" in Windows Start menu)
2. Navigate to where you want the project (for example, your Documents folder):
   ```bash
   cd ~/Documents
   ```
3. Clone the project (replace `<repository-url>` with the actual URL):
   ```bash
   git clone <repository-url>
   cd nia-universal
   ```

### Step 3: Set Up the Project

1. Initialize submodules (this downloads additional code needed):
   ```bash
   git submodule update --init --recursive
   ```

2. Install all project files:
   ```bash
   npm install
   ```
   *This will take 2-5 minutes. Be patient!*

### Step 4: Configure Environment

1. Copy the example configuration file:
   ```bash
   cp config/env.minimal.example .env.local
   ```

2. Generate secret keys (run these commands and **copy the output**):
   ```bash
   openssl rand -base64 32
   ```
   Run this command **three times** and save each result - you'll need them!

3. Open the `.env.local` file in a text editor (like Notepad):
   ```bash
   notepad .env.local
   ```

4. Find these lines and replace the placeholder values:
   - `NEXTAUTH_SECRET=` - Paste your first generated secret
   - `MESH_SHARED_SECRET=` - Paste your second generated secret
   - `TOKEN_ENCRYPTION_KEY=` - Paste your third generated secret
   - `BOT_CONTROL_SHARED_SECRET=` - Generate another secret (run `openssl rand -base64 32` again)

5. Set your database password (if you installed PostgreSQL directly):
   - `POSTGRES_PASSWORD=` - Use the password you set during PostgreSQL installation

6. **Optional:** If you want voice features, add your API keys:
   - `DAILY_API_KEY=` - Get from https://www.daily.co/
   - `OPENAI_API_KEY=` - Get from https://platform.openai.com/api-keys
   - `DEEPGRAM_API_KEY=` - Get from https://console.deepgram.com/

### Step 5: Start PostgreSQL

**If using Docker:**
```bash
docker run -d --name nia-postgres -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=testdb -p 5432:5432 postgres:15
```

**If using local PostgreSQL:**
Make sure PostgreSQL is running (it usually starts automatically). If not:
- Open Services (search "Services" in Windows)
- Find "postgresql" service
- Right-click and select "Start"

### Step 6: Run the Project

1. Start everything:
   ```bash
   npm run start:all
   ```

2. Wait for it to finish starting (you'll see messages like "ready" or "compiled successfully")

3. Open your web browser and go to:
   - **Main App:** http://localhost:3000
   - **Admin Panel:** http://localhost:4000
   - **API Playground:** http://localhost:2000/graphql

**That's it! You're done!** 🎉

---

## 🐧 Linux Setup

### Step 1: Install Required Programs

Open a terminal (press `Ctrl+Alt+T` or search for "Terminal").

#### Install Node.js and npm
```bash
# For Ubuntu/Debian:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# For Fedora:
sudo dnf install -y nodejs npm

# For Arch Linux:
sudo pacman -S nodejs npm
```

#### Install Git
```bash
# Ubuntu/Debian:
sudo apt install git

# Fedora:
sudo dnf install git

# Arch Linux:
sudo pacman -S git
```

#### Install PostgreSQL (Choose One Option)

**Option A: Using Docker (Easier)**
```bash
# Install Docker
sudo apt install docker.io docker-compose  # Ubuntu/Debian
# OR
sudo dnf install docker docker-compose      # Fedora

# Start Docker service
sudo systemctl start docker
sudo systemctl enable docker

# Add your user to docker group (so you don't need sudo)
sudo usermod -aG docker $USER
# Log out and log back in for this to take effect
```

**Option B: Install PostgreSQL Directly**
```bash
# Ubuntu/Debian:
sudo apt update
sudo apt install postgresql postgresql-contrib

# Fedora:
sudo dnf install postgresql postgresql-server

# Arch Linux:
sudo pacman -S postgresql

# Start PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Set password for postgres user
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'password';"

# Create database
createdb -U postgres testdb
```

#### Install Python (for voice features)
```bash
# Ubuntu/Debian:
sudo apt install python3.11 python3.11-venv python3-pip

# Fedora:
sudo dnf install python3.11 python3-pip

# Arch Linux:
sudo pacman -S python python-pip
```

### Step 2: Get the Project Code

1. Navigate to where you want the project:
   ```bash
   cd ~/Documents
   ```

2. Clone the project:
   ```bash
   git clone <repository-url>
   cd nia-universal
   ```

### Step 3: Set Up the Project

1. Initialize submodules:
   ```bash
   git submodule update --init --recursive
   ```

2. Install all project files:
   ```bash
   npm install
   ```
   *This will take 2-5 minutes.*

### Step 4: Configure Environment

1. Copy the example configuration:
   ```bash
   cp config/env.minimal.example .env.local
   ```

2. Generate secret keys (run three times and save each result):
   ```bash
   openssl rand -base64 32
   ```

3. Open the file in a text editor:
   ```bash
   nano .env.local
   # OR
   gedit .env.local
   # OR
   code .env.local  # if you have VS Code
   ```

4. Replace the placeholder values (same as Windows Step 4)

5. Save and close (in nano: press `Ctrl+X`, then `Y`, then `Enter`)

### Step 5: Start PostgreSQL

**If using Docker:**
```bash
docker run -d --name nia-postgres -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=testdb -p 5432:5432 postgres:15
```

**If using local PostgreSQL:**
Make sure it's running:
```bash
sudo systemctl status postgresql
# If not running:
sudo systemctl start postgresql
```

### Step 6: Run the Project

```bash
npm run start:all
```

Then open your browser to:
- **Main App:** http://localhost:3000
- **Admin Panel:** http://localhost:4000
- **API Playground:** http://localhost:2000/graphql

**You're all set!** 🎉

---

## 🍎 Mac Setup

### Step 1: Install Homebrew (Package Manager)

If you don't have Homebrew, install it first:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the instructions on screen. You may need to enter your password.

### Step 2: Install Required Programs

#### Install Node.js and npm
```bash
brew install node
```

#### Install Git
```bash
brew install git
```

#### Install PostgreSQL (Choose One Option)

**Option A: Using Docker (Easier)**
```bash
# Install Docker Desktop
brew install --cask docker

# Open Docker Desktop from Applications and start it
```

**Option B: Install PostgreSQL Directly**
```bash
brew install postgresql@15

# Start PostgreSQL
brew services start postgresql@15

# Set password
psql -U postgres -c "ALTER USER postgres WITH PASSWORD 'password';"

# Create database
createdb -U postgres testdb
```

#### Install Python (for voice features)
```bash
brew install python@3.11
```

### Step 3: Get the Project Code

1. Open Terminal (press `Cmd+Space`, type "Terminal", press Enter)

2. Navigate to where you want the project:
   ```bash
   cd ~/Documents
   ```

3. Clone the project:
   ```bash
   git clone <repository-url>
   cd nia-universal
   ```

### Step 4: Set Up the Project

1. Initialize submodules:
   ```bash
   git submodule update --init --recursive
   ```

2. Install all project files:
   ```bash
   npm install
   ```
   *This will take 2-5 minutes.*

### Step 5: Configure Environment

1. Copy the example configuration:
   ```bash
   cp config/env.minimal.example .env.local
   ```

2. Generate secret keys (run three times):
   ```bash
   openssl rand -base64 32
   ```

3. Open the file:
   ```bash
   open -a TextEdit .env.local
   # OR
   code .env.local  # if you have VS Code
   ```

4. Replace the placeholder values (same as Windows Step 4)

5. Save and close

### Step 6: Start PostgreSQL

**If using Docker:**
```bash
docker run -d --name nia-postgres -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=testdb -p 5432:5432 postgres:15
```

**If using local PostgreSQL:**
Make sure it's running:
```bash
brew services list | grep postgresql
# If not running:
brew services start postgresql@15
```

### Step 7: Run the Project

```bash
npm run start:all
```

Then open your browser to:
- **Main App:** http://localhost:3000
- **Admin Panel:** http://localhost:4000
- **API Playground:** http://localhost:2000/graphql

**Done!** 🎉

---

## 🎯 Quick Reference: What Each App Does

| URL | What It Is |
|-----|------------|
| http://localhost:3000 | **Interface** - The main app where users interact |
| http://localhost:4000 | **Dashboard** - Admin panel to manage the system |
| http://localhost:2000/graphql | **Mesh GraphQL** - API playground to test queries |

---

## 🔧 Common Problems and Solutions

### Problem: "Command not found" or "node: command not found"

**Solution:** Node.js isn't installed or isn't in your PATH.
- **Windows:** Reinstall Node.js and make sure "Add to PATH" is checked
- **Linux/Mac:** Make sure you installed Node.js correctly. Try: `which node` to see if it's found

### Problem: "Cannot connect to database"

**Solution:** PostgreSQL isn't running.
- **Docker:** Check if the container is running: `docker ps | grep postgres`
- **Local:** 
  - **Windows:** Check Services
  - **Linux:** `sudo systemctl status postgresql`
  - **Mac:** `brew services list | grep postgresql`

### Problem: "Port 3000 already in use"

**Solution:** Something else is using that port.
- **Windows:** 
  ```bash
  netstat -ano | findstr :3000
  taskkill /PID <number> /F
  ```
- **Linux/Mac:**
  ```bash
  lsof -ti:3000 | xargs kill -9
  ```

### Problem: "NEXTAUTH_SECRET is not set"

**Solution:** You forgot to set the secret in `.env.local`. Open the file and make sure `NEXTAUTH_SECRET=` has a value (not empty).

### Problem: npm install fails with errors

**Solution:** 
1. Make sure you have the latest Node.js (version 20+)
2. Try deleting `node_modules` folder and `package-lock.json`, then run `npm install` again
3. On Windows, make sure you're using Git Bash, not Command Prompt

### Problem: "Permission denied" (Linux/Mac)

**Solution:** You might need to use `sudo` for some commands, or fix file permissions:
```bash
sudo chown -R $USER:$USER .
```

---

## 📚 Next Steps

Once everything is running:

1. **Explore the Interface:** Go to http://localhost:3000 and see what the app can do
2. **Check the Dashboard:** Visit http://localhost:4000 to see admin features
3. **Read the Docs:** Check out `README.md` and `DEVELOPER_GUIDE.md` for more information
4. **Add Features:** Look in `apps/interface/src/features/` to see how features are built

---

## 💡 Tips

- **Keep the terminal open** while the project is running - closing it will stop the apps
- **Use separate terminals** if you want to run commands while the project is running
- **Check the logs** in the terminal - they'll tell you if something goes wrong
- **Save your `.env.local` file** - you'll need it every time you work on the project

---

## 🆘 Still Having Problems?

1. Check that all prerequisites are installed correctly
2. Make sure all ports (3000, 4000, 2000, 5432) are available
3. Verify your `.env.local` file has all required values set
4. Look at the error messages in the terminal - they usually tell you what's wrong
5. Check the other setup guides in the project:
   - `SIMPLE_SETUP.md` - Even simpler guide
   - `WINDOWS_SETUP.md` - Windows-specific details
   - `MACOS_SETUP.md` - Mac-specific details
   - `LINUX_SETUP.md` - Linux-specific details

---

**Happy coding!** 🚀

