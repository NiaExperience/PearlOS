// Fluent Task Manager Example with separate HTML, CSS, and JS content

export const fluentTaskManagerExample = {
  title: "Fluent Task Manager",
  contentType: "app" as const,
  
  htmlContent: `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Fluent Task Manager</title>
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
</head>
<body>
    <div class="app-container">
        <header class="header">
            <div class="header-content">
                <h1 class="header-title">
                    <span class="material-icons">task_alt</span>
                    Fluent Task Manager
                </h1>
                <div class="header-stats">
                    <div class="stat-card">
                        <span class="material-icons">description</span>
                        <div class="stat-info">
                            <div class="stat-number" id="totalCount">0</div>
                            <div class="stat-label">Total</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <span class="material-icons">pending_actions</span>
                        <div class="stat-info">
                            <div class="stat-number" id="pendingCount">0</div>
                            <div class="stat-label">Pending</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <span class="material-icons">check_circle</span>
                        <div class="stat-info">
                            <div class="stat-number" id="completedCount">0</div>
                            <div class="stat-label">Completed</div>
                        </div>
                    </div>
                </div>
            </div>
        </header>

        <main class="main-content">
            <div class="content-wrapper">
                <div class="action-bar">
                    <div class="add-task-container">
                        <div class="input-group">
                            <span class="material-icons input-icon">add_task</span>
                            <input 
                                type="text" 
                                id="taskInput" 
                                class="task-input" 
                                placeholder="What needs to be done?"
                                aria-label="Add new task"
                            >
                            <button class="add-btn" onclick="addTask()" aria-label="Add task">
                                <span class="material-icons">add</span>
                            </button>
                        </div>
                    </div>
                    
                    <div class="filter-buttons">
                        <button class="filter-btn active" data-filter="all">
                            <span class="material-icons">list</span>
                            All
                        </button>
                        <button class="filter-btn" data-filter="pending">
                            <span class="material-icons">pending</span>
                            Pending
                        </button>
                        <button class="filter-btn" data-filter="completed">
                            <span class="material-icons">done_all</span>
                            Completed
                        </button>
                    </div>
                </div>

                <div class="tasks-container">
                    <div id="tasksList" class="tasks-list">
                        <div class="empty-state">
                            <span class="material-icons">inbox</span>
                            <h3>No tasks yet</h3>
                            <p>Add your first task to get started</p>
                        </div>
                    </div>
                </div>

                <div class="bottom-actions">
                    <button class="secondary-btn" onclick="clearCompleted()">
                        <span class="material-icons">delete_sweep</span>
                        Clear Completed
                    </button>
                    <button class="secondary-btn" onclick="exportTasks()">
                        <span class="material-icons">download</span>
                        Export
                    </button>
                </div>
            </div>
        </main>
    </div>

    <div id="notification" class="notification"></div>
</body>
</html>`,

  cssContent: `/* Fluent 2 Design System CSS */
:root {
    --fluent-primary: #0078d4;
    --fluent-primary-hover: #106ebe;
    --fluent-secondary: #6264a7;
    --fluent-neutral-100: #f3f2f1;
    --fluent-neutral-200: #edebe9;
    --fluent-neutral-300: #e1dfdd;
    --fluent-neutral-800: #323130;
    --fluent-neutral-900: #201f1e;
    --fluent-success: #107c10;
    --fluent-danger: #d13438;
    --fluent-shadow: 0 1px 2px rgba(0,0,0,0.1), 0 2px 4px rgba(0,0,0,0.1);
    --fluent-radius-sm: 4px;
    --fluent-radius-md: 8px;
    --fluent-radius-lg: 12px;
    --fluent-spacing-xs: 4px;
    --fluent-spacing-sm: 8px;
    --fluent-spacing-md: 12px;
    --fluent-spacing-lg: 16px;
    --fluent-spacing-xl: 20px;
    --fluent-spacing-xxl: 24px;
}

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

html, body {
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    font-family: 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif;
    background: var(--fluent-neutral-100);
    color: var(--fluent-neutral-900);
}

.app-container {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
}

.header {
    background: white;
    border-bottom: 1px solid var(--fluent-neutral-300);
    box-shadow: var(--fluent-shadow);
    padding: var(--fluent-spacing-xl);
}

.header-content {
    max-width: 1200px;
    margin: 0 auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--fluent-spacing-lg);
}

.header-title {
    display: flex;
    align-items: center;
    gap: var(--fluent-spacing-md);
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--fluent-neutral-900);
}

.header-title .material-icons {
    color: var(--fluent-primary);
    font-size: 1.8rem;
}

.header-stats {
    display: flex;
    gap: var(--fluent-spacing-lg);
    flex-wrap: wrap;
}

.stat-card {
    display: flex;
    align-items: center;
    gap: var(--fluent-spacing-sm);
    background: var(--fluent-neutral-100);
    padding: var(--fluent-spacing-md) var(--fluent-spacing-lg);
    border-radius: var(--fluent-radius-md);
    border: 1px solid var(--fluent-neutral-300);
    min-width: 100px;
}

.stat-card .material-icons {
    color: var(--fluent-primary);
    font-size: 1.2rem;
}

.stat-info {
    display: flex;
    flex-direction: column;
}

.stat-number {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--fluent-primary);
    line-height: 1;
}

.stat-label {
    font-size: 0.75rem;
    color: var(--fluent-neutral-800);
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.main-content {
    padding: var(--fluent-spacing-xl);
    overflow-y: auto;
    background: var(--fluent-neutral-100);
}

.content-wrapper {
    max-width: 1200px;
    margin: 0 auto;
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: var(--fluent-spacing-xl);
    height: 100%;
}

.action-bar {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--fluent-spacing-xl);
    align-items: start;
}

.add-task-container {
    background: white;
    padding: var(--fluent-spacing-xl);
    border-radius: var(--fluent-radius-lg);
    box-shadow: var(--fluent-shadow);
    border: 1px solid var(--fluent-neutral-300);
}

.input-group {
    display: flex;
    align-items: center;
    gap: var(--fluent-spacing-sm);
    position: relative;
}

.input-icon {
    color: var(--fluent-primary);
    font-size: 1.2rem;
}

.task-input {
    flex: 1;
    padding: var(--fluent-spacing-md) var(--fluent-spacing-lg);
    border: 2px solid var(--fluent-neutral-300);
    border-radius: var(--fluent-radius-md);
    font-size: 1rem;
    background: white;
    transition: all 0.2s ease-in-out;
    min-height: 44px;
}

.task-input:focus {
    outline: none;
    border-color: var(--fluent-primary);
    box-shadow: 0 0 0 2px rgba(0, 120, 212, 0.2);
}

.add-btn {
    padding: var(--fluent-spacing-md) var(--fluent-spacing-lg);
    background: var(--fluent-primary);
    color: white;
    border: none;
    border-radius: var(--fluent-radius-md);
    cursor: pointer;
    transition: all 0.2s ease-in-out;
    display: flex;
    align-items: center;
    gap: var(--fluent-spacing-xs);
    font-weight: 500;
    min-height: 44px;
}

.add-btn:hover {
    background: var(--fluent-primary-hover);
    transform: translateY(-1px);
    box-shadow: var(--fluent-shadow);
}

.filter-buttons {
    display: flex;
    gap: var(--fluent-spacing-sm);
    background: white;
    padding: var(--fluent-spacing-md);
    border-radius: var(--fluent-radius-lg);
    box-shadow: var(--fluent-shadow);
    border: 1px solid var(--fluent-neutral-300);
}

.filter-btn {
    display: flex;
    align-items: center;
    gap: var(--fluent-spacing-xs);
    padding: var(--fluent-spacing-sm) var(--fluent-spacing-md);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--fluent-radius-sm);
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--fluent-neutral-800);
    transition: all 0.2s ease-in-out;
    min-height: 36px;
}

.filter-btn:hover {
    background: var(--fluent-neutral-200);
}

.filter-btn.active {
    background: var(--fluent-primary);
    color: white;
    border-color: var(--fluent-primary);
}

.filter-btn .material-icons {
    font-size: 1rem;
}

.tasks-container {
    background: white;
    border-radius: var(--fluent-radius-lg);
    box-shadow: var(--fluent-shadow);
    border: 1px solid var(--fluent-neutral-300);
    overflow: hidden;
    min-height: 300px;
}

.tasks-list {
    padding: var(--fluent-spacing-lg);
    max-height: 60vh;
    overflow-y: auto;
}

.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: var(--fluent-spacing-xxl);
    color: var(--fluent-neutral-800);
}

.empty-state .material-icons {
    font-size: 3rem;
    color: var(--fluent-neutral-300);
    margin-bottom: var(--fluent-spacing-md);
}

.empty-state h3 {
    margin-bottom: var(--fluent-spacing-sm);
    font-weight: 500;
}

.empty-state p {
    color: var(--fluent-neutral-800);
    font-size: 0.875rem;
}

.task-item {
    display: flex;
    align-items: center;
    gap: var(--fluent-spacing-md);
    padding: var(--fluent-spacing-lg);
    background: var(--fluent-neutral-100);
    border: 1px solid var(--fluent-neutral-300);
    border-radius: var(--fluent-radius-md);
    margin-bottom: var(--fluent-spacing-sm);
    transition: all 0.2s ease-in-out;
    cursor: pointer;
}

.task-item:hover {
    transform: translateY(-1px);
    box-shadow: var(--fluent-shadow);
    border-color: var(--fluent-primary);
}

.task-item.completed {
    opacity: 0.7;
    background: var(--fluent-neutral-200);
}

.task-item.completed .task-text {
    text-decoration: line-through;
}

.task-checkbox {
    width: 20px;
    height: 20px;
    border: 2px solid var(--fluent-primary);
    border-radius: var(--fluent-radius-sm);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    background: white;
    transition: all 0.2s ease-in-out;
}

.task-checkbox.checked {
    background: var(--fluent-primary);
    color: white;
}

.task-checkbox .material-icons {
    font-size: 14px;
}

.task-text {
    flex: 1;
    font-size: 1rem;
    color: var(--fluent-neutral-900);
}

.task-actions {
    display: flex;
    gap: var(--fluent-spacing-xs);
}

.task-btn {
    padding: var(--fluent-spacing-xs);
    background: transparent;
    border: none;
    border-radius: var(--fluent-radius-sm);
    cursor: pointer;
    color: var(--fluent-neutral-800);
    transition: all 0.2s ease-in-out;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
}

.task-btn:hover {
    background: var(--fluent-neutral-200);
}

.task-btn.delete:hover {
    background: var(--fluent-danger);
    color: white;
}

.bottom-actions {
    display: flex;
    gap: var(--fluent-spacing-md);
    justify-content: center;
}

.secondary-btn {
    display: flex;
    align-items: center;
    gap: var(--fluent-spacing-xs);
    padding: var(--fluent-spacing-md) var(--fluent-spacing-lg);
    background: white;
    border: 1px solid var(--fluent-neutral-300);
    border-radius: var(--fluent-radius-md);
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--fluent-neutral-800);
    transition: all 0.2s ease-in-out;
    min-height: 40px;
}

.secondary-btn:hover {
    background: var(--fluent-neutral-200);
    transform: translateY(-1px);
    box-shadow: var(--fluent-shadow);
}

.notification {
    position: fixed;
    top: var(--fluent-spacing-xl);
    right: var(--fluent-spacing-xl);
    background: var(--fluent-success);
    color: white;
    padding: var(--fluent-spacing-md) var(--fluent-spacing-xl);
    border-radius: var(--fluent-radius-md);
    box-shadow: var(--fluent-shadow);
    transform: translateX(400px);
    transition: transform 0.3s ease-in-out;
    z-index: 1000;
}

.notification.show {
    transform: translateX(0);
}

/* Mobile Responsive */
@media (max-width: 768px) {
    .header-content {
        flex-direction: column;
        text-align: center;
    }
    
    .header-stats {
        justify-content: center;
    }
    
    .action-bar {
        grid-template-columns: 1fr;
        gap: var(--fluent-spacing-md);
    }
    
    .filter-buttons {
        justify-content: center;
    }
    
    .stat-card {
        min-width: 80px;
    }
    
    .bottom-actions {
        flex-direction: column;
    }
}

@media (max-width: 480px) {
    .main-content {
        padding: var(--fluent-spacing-md);
    }
    
    .header {
        padding: var(--fluent-spacing-md);
    }
    
    .header-stats {
        gap: var(--fluent-spacing-sm);
    }
    
    .filter-buttons {
        flex-wrap: wrap;
    }
}`,

  jsContent: `// Fluent Task Manager JavaScript
class TaskManager {
    constructor() {
        this.tasks = JSON.parse(localStorage.getItem('fluent-tasks') || '[]');
        this.currentFilter = 'all';
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.renderTasks();
        this.updateStats();
        this.showWelcomeMessage();
    }

    setupEventListeners() {
        // Task input
        const taskInput = document.getElementById('taskInput');
        taskInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.addTask();
            }
        });

        // Filter buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const filter = e.currentTarget.dataset.filter;
                this.setFilter(filter);
            });
        });

        // Add smooth scrolling for task list
        this.setupSmoothScrolling();
    }

    addTask() {
        const taskInput = document.getElementById('taskInput');
        const text = taskInput.value.trim();
        
        if (!text) {
            this.showNotification('Please enter a task description', 'warning');
            return;
        }

        const newTask = {
            id: Date.now(),
            text,
            completed: false,
            createdAt: new Date().toISOString(),
            priority: 'normal'
        };

        this.tasks.unshift(newTask);
        taskInput.value = '';
        
        this.saveTasks();
        this.renderTasks();
        this.updateStats();
        this.showNotification('Task added successfully!');
        
        // Add entrance animation
        setTimeout(() => {
            const firstTask = document.querySelector('.task-item');
            if (firstTask) {
                firstTask.style.animation = 'slideInFromTop 0.3s ease-out';
            }
        }, 100);
    }

    toggleTask(id) {
        const task = this.tasks.find(t => t.id === id);
        if (task) {
            task.completed = !task.completed;
            task.completedAt = task.completed ? new Date().toISOString() : null;
            
            this.saveTasks();
            this.renderTasks();
            this.updateStats();
            
            const message = task.completed ? 'Task completed! 🎉' : 'Task marked as pending';
            this.showNotification(message);
        }
    }

    deleteTask(id) {
        const taskElement = document.querySelector(\`[data-task-id="\${id}"]\`);
        if (taskElement) {
            taskElement.style.animation = 'slideOutToRight 0.3s ease-in';
            setTimeout(() => {
                this.tasks = this.tasks.filter(t => t.id !== id);
                this.saveTasks();
                this.renderTasks();
                this.updateStats();
                this.showNotification('Task deleted');
            }, 300);
        }
    }

    setFilter(filter) {
        this.currentFilter = filter;
        
        // Update active filter button
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(\`[data-filter="\${filter}"]\`).classList.add('active');
        
        this.renderTasks();
    }

    renderTasks() {
        const tasksList = document.getElementById('tasksList');
        const filteredTasks = this.getFilteredTasks();
        
        if (filteredTasks.length === 0) {
            tasksList.innerHTML = this.getEmptyStateHTML();
            return;
        }

        tasksList.innerHTML = filteredTasks.map(task => this.getTaskHTML(task)).join('');
        
        // Add event listeners to task elements
        this.attachTaskEventListeners();
    }

    getFilteredTasks() {
        switch (this.currentFilter) {
            case 'pending':
                return this.tasks.filter(t => !t.completed);
            case 'completed':
                return this.tasks.filter(t => t.completed);
            default:
                return this.tasks;
        }
    }

    getTaskHTML(task) {
        return \`
            <div class="task-item \${task.completed ? 'completed' : ''}" data-task-id="\${task.id}">
                <div class="task-checkbox \${task.completed ? 'checked' : ''}" onclick="taskManager.toggleTask(\${task.id})">
                    \${task.completed ? '<span class="material-icons">check</span>' : ''}
                </div>
                <div class="task-text" onclick="taskManager.toggleTask(\${task.id})">
                    \${this.escapeHtml(task.text)}
                </div>
                <div class="task-actions">
                    <button class="task-btn edit" onclick="taskManager.editTask(\${task.id})" title="Edit task">
                        <span class="material-icons">edit</span>
                    </button>
                    <button class="task-btn delete" onclick="taskManager.deleteTask(\${task.id})" title="Delete task">
                        <span class="material-icons">delete</span>
                    </button>
                </div>
            </div>
        \`;
    }

    getEmptyStateHTML() {
        const messages = {
            all: { icon: 'inbox', title: 'No tasks yet', subtitle: 'Add your first task to get started' },
            pending: { icon: 'pending_actions', title: 'No pending tasks', subtitle: 'All caught up! Great job!' },
            completed: { icon: 'task_alt', title: 'No completed tasks', subtitle: 'Complete some tasks to see them here' }
        };
        
        const message = messages[this.currentFilter];
        
        return \`
            <div class="empty-state">
                <span class="material-icons">\${message.icon}</span>
                <h3>\${message.title}</h3>
                <p>\${message.subtitle}</p>
            </div>
        \`;
    }

    attachTaskEventListeners() {
        // Add ripple effect to task items
        document.querySelectorAll('.task-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!e.target.closest('.task-actions') && !e.target.closest('.task-checkbox')) {
                    this.addRippleEffect(e.currentTarget, e);
                }
            });
        });
    }

    updateStats() {
        const total = this.tasks.length;
        const completed = this.tasks.filter(t => t.completed).length;
        const pending = total - completed;
        
        this.animateCounter('totalCount', total);
        this.animateCounter('completedCount', completed);
        this.animateCounter('pendingCount', pending);
    }

    animateCounter(elementId, targetValue) {
        const element = document.getElementById(elementId);
        const currentValue = parseInt(element.textContent) || 0;
        const duration = 300;
        const steps = 20;
        const stepValue = (targetValue - currentValue) / steps;
        
        let step = 0;
        const timer = setInterval(() => {
            step++;
            const value = Math.round(currentValue + (stepValue * step));
            element.textContent = value;
            
            if (step >= steps) {
                clearInterval(timer);
                element.textContent = targetValue;
            }
        }, duration / steps);
    }

    clearCompleted() {
        const completedTasks = this.tasks.filter(t => t.completed);
        if (completedTasks.length === 0) {
            this.showNotification('No completed tasks to clear', 'info');
            return;
        }

        this.tasks = this.tasks.filter(t => !t.completed);
        this.saveTasks();
        this.renderTasks();
        this.updateStats();
        this.showNotification(\`Cleared \${completedTasks.length} completed task(s)\`);
    }

    exportTasks() {
        if (this.tasks.length === 0) {
            this.showNotification('No tasks to export', 'info');
            return;
        }

        const exportData = {
            exportDate: new Date().toISOString(),
            totalTasks: this.tasks.length,
            completedTasks: this.tasks.filter(t => t.completed).length,
            tasks: this.tasks
        };

        const dataStr = JSON.stringify(exportData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = \`fluent-tasks-\${new Date().toISOString().split('T')[0]}.json\`;
        link.click();
        
        URL.revokeObjectURL(url);
        this.showNotification('Tasks exported successfully!');
    }

    saveTasks() {
        localStorage.setItem('fluent-tasks', JSON.stringify(this.tasks));
    }

    showNotification(message, type = 'success') {
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.className = \`notification \${type} show\`;
        
        setTimeout(() => {
            notification.classList.remove('show');
        }, 3000);
    }

    showWelcomeMessage() {
        if (this.tasks.length === 0) {
            setTimeout(() => {
                this.showNotification('Welcome to Fluent Task Manager! 👋', 'info');
            }, 1000);
        }
    }

    addRippleEffect(element, event) {
        const ripple = document.createElement('div');
        const rect = element.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const x = event.clientX - rect.left - size / 2;
        const y = event.clientY - rect.top - size / 2;
        
        ripple.style.cssText = \`
            position: absolute;
            width: \${size}px;
            height: \${size}px;
            left: \${x}px;
            top: \${y}px;
            background: rgba(0, 120, 212, 0.3);
            border-radius: 50%;
            transform: scale(0);
            animation: ripple 0.6s ease-out;
            pointer-events: none;
        \`;
        
        const style = document.createElement('style');
        style.textContent = \`
            @keyframes ripple {
                to {
                    transform: scale(2);
                    opacity: 0;
                }
            }
            @keyframes slideInFromTop {
                from {
                    transform: translateY(-20px);
                    opacity: 0;
                }
                to {
                    transform: translateY(0);
                    opacity: 1;
                }
            }
            @keyframes slideOutToRight {
                to {
                    transform: translateX(100%);
                    opacity: 0;
                }
            }
        \`;
        
        if (!document.querySelector('style[data-animations]')) {
            style.setAttribute('data-animations', '');
            document.head.appendChild(style);
        }
        
        element.style.position = 'relative';
        element.style.overflow = 'hidden';
        element.appendChild(ripple);
        
        setTimeout(() => {
            ripple.remove();
        }, 600);
    }

    setupSmoothScrolling() {
        const tasksList = document.getElementById('tasksList');
        if (tasksList) {
            tasksList.style.scrollBehavior = 'smooth';
        }
    }

    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }
}

// Global functions for HTML onclick handlers
function addTask() {
    taskManager.addTask();
}

function clearCompleted() {
    taskManager.clearCompleted();
}

function exportTasks() {
    taskManager.exportTasks();
}

// Initialize the app
let taskManager;
document.addEventListener('DOMContentLoaded', () => {
    taskManager = new TaskManager();
});`
};