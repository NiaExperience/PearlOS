/**
 * Form Validation Example - Push Up Pals App
 * 
 * This example demonstrates proper form validation with clear format guidance
        const logger = window.logger ?? { info: () => {} };
 * to solve the "Please match the requested format" UX issue.
 */

export const formValidationExample = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Push Up Pals - Track Group Push-ups</title>
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }

        .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 800px;
            width: 100%;
            overflow: hidden;
        }

        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }

        .header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
        }

        .header p {
            font-size: 1.1em;
            opacity: 0.9;
        }

        .content {
            padding: 40px;
        }

        .form-section {
            margin-bottom: 30px;
        }

        .form-section h3 {
            color: #333;
            margin-bottom: 20px;
            font-size: 1.3em;
        }

        .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 20px;
        }

        .form-group {
            position: relative;
        }

        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #333;
        }

        .form-group input {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid #e1dfdd;
            border-radius: 8px;
            font-size: 16px;
            transition: all 0.2s ease-in-out;
        }

        .form-group input:focus {
            outline: none;
            border-color: #0078d4;
            box-shadow: 0 0 0 3px rgba(0, 120, 212, 0.1);
        }

        .form-group input.error {
            border-color: #d13438;
            box-shadow: 0 0 0 3px rgba(209, 52, 56, 0.1);
        }

        .form-group input.valid {
            border-color: #107c10;
            box-shadow: 0 0 0 3px rgba(16, 124, 16, 0.1);
        }

        .format-hint {
            font-size: 12px;
            color: #666;
            margin-top: 4px;
            font-style: italic;
        }

        .error-message {
            color: #d13438;
            font-size: 12px;
            margin-top: 4px;
            display: none;
        }

        .error-message.show {
            display: block;
        }

        .success-message {
            color: #107c10;
            font-size: 12px;
            margin-top: 4px;
            display: none;
        }

        .success-message.show {
            display: block;
        }

        .btn {
            background: #0078d4;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease-in-out;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }

        .btn:hover {
            background: #106ebe;
            transform: translateY(-1px);
        }

        .btn:disabled {
            background: #ccc;
            cursor: not-allowed;
            transform: none;
        }

        .btn-clear {
            background: #6c757d;
            margin-left: 10px;
        }

        .btn-clear:hover {
            background: #5a6268;
        }

        .search-section {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin-top: 20px;
        }

        .search-section h4 {
            margin-bottom: 15px;
            color: #333;
        }

        .search-controls {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 15px;
        }

        @media (max-width: 768px) {
            .form-row {
                grid-template-columns: 1fr;
            }
            
            .search-controls {
                grid-template-columns: 1fr;
            }
            
            .content {
                padding: 20px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏋️ Push Up Pals</h1>
            <p>Track group push-ups, motivate each other!</p>
        </div>
        
        <div class="content">
            <div class="form-section">
                <h3>👤 Member Information</h3>
                <div class="form-row">
                    <div class="form-group">
                        <label for="name">Name</label>
                        <input type="text" id="name" placeholder="Enter your full name" value="Stephanie Riggs">
                        <div class="format-hint">Enter your first and last name</div>
                        <div class="error-message" id="name-error"></div>
                        <div class="success-message" id="name-success"></div>
                    </div>
                    
                    <div class="form-group">
                        <label for="phone">Phone Number</label>
                        <input type="tel" id="phone" placeholder="(555) 123-4567" pattern="[0-9\\s\\-\\(\\)]+" title="Format: (555) 123-4567 or 555-123-4567" value="310-595-4459">
                        <div class="format-hint">Format: (555) 123-4567 or 555-123-4567</div>
                        <div class="error-message" id="phone-error"></div>
                        <div class="success-message" id="phone-success"></div>
                    </div>
                </div>
                
                <div class="form-row">
                    <div class="form-group">
                        <label for="email">Email</label>
                        <input type="email" id="email" placeholder="user@example.com" title="Format: user@example.com">
                        <div class="format-hint">Format: user@example.com</div>
                        <div class="error-message" id="email-error"></div>
                        <div class="success-message" id="email-success"></div>
                    </div>
                    
                    <div class="form-group">
                        <label for="birthDate">Birth Date</label>
                        <input type="date" id="birthDate" title="Format: YYYY-MM-DD">
                        <div class="format-hint">Format: YYYY-MM-DD</div>
                        <div class="error-message" id="birthDate-error"></div>
                        <div class="success-message" id="birthDate-success"></div>
                    </div>
                </div>
                
                <div style="margin-top: 20px;">
                    <button class="btn" onclick="saveMember()">
                        <span class="material-icons">save</span>
                        Save Member
                    </button>
                    <button class="btn btn-clear" onclick="clearForm()">
                        <span class="material-icons">clear</span>
                        Clear
                    </button>
                </div>
            </div>
            
            <div class="search-section">
                <h4>🔍 Search & Filter</h4>
                <div class="search-controls">
                    <div class="form-group">
                        <label for="search">Search</label>
                        <input type="text" id="search" placeholder="Search members...">
                    </div>
                    <div class="form-group">
                        <label for="sort">Sort</label>
                        <select id="sort">
                            <option value="name">Name</option>
                            <option value="phone">Phone</option>
                            <option value="email">Email</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="page">Page</label>
                        <input type="number" id="page" placeholder="1" min="1" value="1">
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        // Validation patterns
        const patterns = {
            phone: /^[\\(]?[0-9]{3}[\\)]?[\\s\\-]?[0-9]{3}[\\s\\-]?[0-9]{4}$/,
            email: /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/,
            name: /^[a-zA-Z\\s]{2,}$/
        };

        // Format examples for error messages
        const formatExamples = {
            phone: "Format: (555) 123-4567 or 555-123-4567",
            email: "Format: user@example.com",
            name: "Format: First Last (letters and spaces only)",
            date: "Format: YYYY-MM-DD"
        };

        // Real-time validation
        document.addEventListener('DOMContentLoaded', function() {
            const inputs = document.querySelectorAll('input[type="tel"], input[type="email"], input[type="text"]');
            
            inputs.forEach(input => {
                input.addEventListener('input', function() {
                    validateInput(this);
                });
                
                input.addEventListener('blur', function() {
                    validateInput(this);
                });
            });
        });

        function validateInput(input) {
            const value = input.value.trim();
            const inputType = input.type;
            const inputId = input.id;
            let isValid = false;
            let errorMessage = '';

            // Clear previous states
            clearMessages(input);

            if (value === '') {
                return; // Don't validate empty fields
            }

            // Phone validation
            if (inputType === 'tel' || inputId === 'phone') {
                isValid = patterns.phone.test(value);
                errorMessage = isValid ? '' : formatExamples.phone;
            }
            // Email validation
            else if (inputType === 'email' || inputId === 'email') {
                isValid = patterns.email.test(value);
                errorMessage = isValid ? '' : formatExamples.email;
            }
            // Name validation
            else if (inputId === 'name') {
                isValid = patterns.name.test(value);
                errorMessage = isValid ? '' : formatExamples.name;
            }
            // Date validation
            else if (inputType === 'date' || inputId === 'birthDate') {
                const date = new Date(value);
                isValid = !isNaN(date.getTime()) && date < new Date();
                errorMessage = isValid ? '' : formatExamples.date;
            }

            // Update UI based on validation result
            if (value !== '') {
                if (isValid) {
                    input.classList.remove('error');
                    input.classList.add('valid');
                    showSuccess(input, '✓ Valid format');
                } else {
                    input.classList.remove('valid');
                    input.classList.add('error');
                    showError(input, errorMessage);
                }
            } else {
                input.classList.remove('error', 'valid');
            }
        }

        function showError(input, message) {
            const errorDiv = input.parentNode.querySelector('.error-message');
            if (errorDiv) {
                errorDiv.textContent = message;
                errorDiv.classList.add('show');
            }
        }

        function showSuccess(input, message) {
            const successDiv = input.parentNode.querySelector('.success-message');
            if (successDiv) {
                successDiv.textContent = message;
                successDiv.classList.add('show');
            }
        }

        function clearMessages(input) {
            const errorDiv = input.parentNode.querySelector('.error-message');
            const successDiv = input.parentNode.querySelector('.success-message');
            
            if (errorDiv) {
                errorDiv.classList.remove('show');
            }
            if (successDiv) {
                successDiv.classList.remove('show');
            }
        }

        function saveMember() {
            const name = document.getElementById('name').value.trim();
            const phone = document.getElementById('phone').value.trim();
            const email = document.getElementById('email').value.trim();
            const birthDate = document.getElementById('birthDate').value;

            // Validate all required fields
            let hasErrors = false;
            const requiredFields = [
                { id: 'name', value: name, type: 'name' },
                { id: 'phone', value: phone, type: 'phone' },
                { id: 'email', value: email, type: 'email' }
            ];

            requiredFields.forEach(field => {
                const input = document.getElementById(field.id);
                if (!field.value) {
                    showError(input, 'This field is required');
                    hasErrors = true;
                } else {
                    validateInput(input);
                    if (input.classList.contains('error')) {
                        hasErrors = true;
                    }
                }
            });

            if (hasErrors) {
                alert('Please fix the errors before saving.');
                return;
            }

            // Save to localStorage (in a real app, this would be an API call)
            const member = {
                name,
                phone,
                email,
                birthDate,
                id: Date.now()
            };

            let members = JSON.parse(localStorage.getItem('pushUpPals') || '[]');
            members.push(member);
            localStorage.setItem('pushUpPals', JSON.stringify(members));

            alert('Member saved successfully!');
            logger.info('Saved member', { member });
        }

        function clearForm() {
            document.getElementById('name').value = '';
            document.getElementById('phone').value = '';
            document.getElementById('email').value = '';
            document.getElementById('birthDate').value = '';
            
            // Clear all validation states
            const inputs = document.querySelectorAll('input');
            inputs.forEach(input => {
                input.classList.remove('error', 'valid');
                clearMessages(input);
            });
        }

        // Auto-format phone number as user types
        document.getElementById('phone').addEventListener('input', function(e) {
            let value = e.target.value.replace(/[^0-9]/g, '');
            
            if (value.length >= 6) {
                value = value.replace(/(\\d{3})(\\d{3})(\\d{4})/, '($1) $2-$3');
            } else if (value.length >= 3) {
                value = value.replace(/(\\d{3})(\\d{0,3})/, '($1) $2');
            }
            
            e.target.value = value;
        });
    </script>
</body>
</html>`;

export default formValidationExample;
