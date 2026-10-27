(function () {
  const form = document.getElementById("form");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("send");
  const chat = document.getElementById("chat");
  const welcome = document.getElementById("welcome");

  let imageMode = false;

  const imageBtn = document.createElement("button");
  imageBtn.type = "button";
  imageBtn.textContent = "Image";
  imageBtn.style.cssText =
    "padding: 0 14px; border-radius: 10px; border: 1px solid var(--border);" +
    "background: var(--panel); color: var(--text); font: inherit; cursor: pointer;";
  form.insertBefore(imageBtn, sendBtn);

  imageBtn.addEventListener("click", () => {
    imageMode = !imageMode;
    imageBtn.style.borderColor = imageMode ? "var(--accent)" : "var(--border)";
    imageBtn.style.color = imageMode ? "var(--accent)" : "var(--text)";
    input.placeholder = imageMode ? "Describe the picture you want..." : "Type your question...";
    input.focus();
  });

  function scrollDown() {
    const main = document.querySelector("main");
    main.scrollTop = main.scrollHeight;
  }

  function addRow(className, node) {
    if (welcome) welcome.style.display = "none";
    const row = document.createElement("div");
    row.className = "message " + className;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.appendChild(node);
    row.appendChild(bubble);
    chat.appendChild(row);
    scrollDown();
    return bubble;
  }

  function textNode(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div;
  }

  form.addEventListener(
    "submit",
    (e) => {
      if (!imageMode) return;
      e.preventDefault();
      e.stopImmediatePropagation();

      const prompt = input.value.trim().slice(0, 300);
      if (!prompt) return;
      input.value = "";
      input.style.height = "auto";

      addRow("user", textNode(prompt));
      const status = textNode("Creating your picture...");
      status.classList.add("typing");
      const bubble = addRow("assistant", status);

      const img = document.createElement("img");
      img.alt = prompt;
      img.style.cssText =
        "display: block; width: 100%; max-width: 512px; border-radius: 10px; margin-top: 8px;";
      img.onload = () => {
        status.textContent = "Here is your picture:";
        status.classList.remove("typing");
      };
      img.onerror = () => {
        status.textContent = "Could not create the picture. Please try again.";
        img.remove();
      };
      img.src =
        "https://image.pollinations.ai/prompt/" +
        encodeURIComponent(prompt) +
        "?width=512&height=512&seed=" +
        Math.floor(Math.random() * 100000);
      bubble.appendChild(img);
      scrollDown();
    },
    true
  );
})();
