import {
  getCurrentUser,
  logEvent,
  onAuthReady,
  registerWithEmail,
} from "./firebase.js?v=20250118";

const form = document.querySelector("#register-form");
const statusEl = document.querySelector("#register-status");
const submitBtn = document.querySelector("#register-submit");
const continueBtn = document.querySelector("#continue-btn");
const emailInput = document.querySelector("#reg-email");
const passwordInput = document.querySelector("#reg-password");

let authReady = false;

const safeLogEvent = (name, meta) => {
  logEvent(name, meta).catch(() => {});
};

const setStatus = (message, tone) => {
  if (!statusEl) {
    return;
  }
  statusEl.textContent = message;
  statusEl.classList.remove("success", "error");
  if (tone) {
    statusEl.classList.add(tone);
  }
};

const showContinue = () => {
  if (continueBtn) {
    continueBtn.classList.remove("hidden");
  }
};

const normalizeError = (error) => {
  if (!error || !error.code) {
    return "Something went wrong. Please try again.";
  }
  switch (error.code) {
    case "auth/email-already-in-use":
      return "This email is already in use. Try another one.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/weak-password":
      return "Password is too weak. Use at least 6 characters.";
    case "auth/operation-not-allowed":
      return "Email registration is not enabled.";
    case "auth/unauthorized-domain":
      return "This domain is not authorized in Firebase Auth.";
    default:
      return "Unable to register. Please try again.";
  }
};

onAuthReady((user) => {
  safeLogEvent("register_view");
  authReady = true;

  if (user && !user.isAnonymous) {
    setStatus("You are already registered.", "success");
    showContinue();
    if (submitBtn) {
      submitBtn.disabled = true;
    }
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = false;
  }
});

if (continueBtn) {
  continueBtn.addEventListener("click", () => {
    safeLogEvent("register_continue");
    window.location.href = "index.html";
  });
}

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!authReady) {
      setStatus("Preparing your session. Please try again in a moment.", "error");
      return;
    }

    const email = emailInput ? emailInput.value.trim() : "";
    const password = passwordInput ? passwordInput.value : "";

    if (!email || !password) {
      setStatus("Enter your email and password to continue.", "error");
      return;
    }

    const user = getCurrentUser();
    if (user && !user.isAnonymous) {
      setStatus("You are already registered.", "success");
      showContinue();
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
    }

    setStatus("Creating your account...", null);
    safeLogEvent("register_submit");

    try {
      await registerWithEmail(email, password);
      safeLogEvent("register_success");
      setStatus("Account created. You can run generation now.", "success");
      showContinue();
    } catch (error) {
      safeLogEvent("register_error", { code: error.code || "unknown" });
      setStatus(normalizeError(error), "error");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
      }
    }
  });
}
