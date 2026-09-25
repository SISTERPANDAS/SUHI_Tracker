let currentMode = 'login';

// Initialize Lucide Icons on load
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
});

function switchAuthTab(mode) {
    currentMode = mode;
    const tabLogin = document.getElementById('tab-login');
    const tabSignup = document.getElementById('tab-signup');
    const nameGroup = document.getElementById('name-group');
    const forgotPass = document.getElementById('forgot-pass-wrapper');
    const btnText = document.getElementById('btn-text');
    const alertBox = document.getElementById('auth-alert');

    alertBox.classList.add('hidden');

    if (mode === 'signup') {
        tabSignup.classList.add('active-tab', 'text-white');
        tabSignup.classList.remove('text-slate-400');
        tabLogin.classList.remove('active-tab', 'text-white');
        tabLogin.classList.add('text-slate-400');
        
        nameGroup.classList.remove('hidden');
        forgotPass.classList.add('hidden');
        btnText.innerText = 'Create Account';
    } else {
        tabLogin.classList.add('active-tab', 'text-white');
        tabLogin.classList.remove('text-slate-400');
        tabSignup.classList.remove('active-tab', 'text-white');
        tabSignup.classList.add('text-slate-400');

        nameGroup.classList.add('hidden');
        forgotPass.classList.remove('hidden');
        btnText.innerText = 'Login';
    }
    lucide.createIcons();
}

function togglePasswordVisibility() {
    const passInput = document.getElementById('user-password');
    const eyeIcon = document.getElementById('eye-icon');
    if (passInput.type === 'password') {
        passInput.type = 'text';
        eyeIcon.setAttribute('data-lucide', 'eye-off');
    } else {
        passInput.type = 'password';
        eyeIcon.setAttribute('data-lucide', 'eye');
    }
    lucide.createIcons();
}

async function handleAuthSubmit(event) {
    event.preventDefault();
    const email = document.getElementById('user-email').value.trim();
    const password = document.getElementById('user-password').value;
    const name = document.getElementById('user-name')?.value.trim() || '';
    const submitBtn = document.getElementById('submit-btn');

    const endpoint = currentMode === 'signup' ? '/api/auth/register' : '/api/auth/login';

    // Disable button temporarily during request
    submitBtn.disabled = true;
    submitBtn.classList.add('opacity-75', 'cursor-not-allowed');

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, name })
        });
        const data = await res.json();

        if (res.ok && data.success) {
            showAlert(
                currentMode === 'signup' 
                    ? 'Registration successful! Entering workspace...' 
                    : 'Login successful! Entering workspace...', 
                'success'
            );
            setTimeout(() => {
                window.location.href = '/dashboard';
            }, 750);
        } else {
            showAlert(data.message || 'Authentication failed. Please check your credentials.', 'error');
        }
    } catch (err) {
        showAlert('Cannot connect to backend server. Please verify Flask is running.', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.classList.remove('opacity-75', 'cursor-not-allowed');
    }
}

function showAlert(message, type) {
    const alertBox = document.getElementById('auth-alert');
    alertBox.classList.remove('hidden');
    if (type === 'error') {
        alertBox.className = 'mb-4 p-3.5 rounded-xl text-xs font-medium border bg-red-950/70 border-red-500/50 text-red-300';
    } else {
        alertBox.className = 'mb-4 p-3.5 rounded-xl text-xs font-medium border bg-teal-950/70 border-teal-500/50 text-teal-300';
    }
    alertBox.innerText = message;
}

function handleGoogleLoginMock() {
    showAlert('Google OAuth initializing...', 'success');
    setTimeout(() => {
        window.location.href = '/dashboard';
    }, 1000);
}