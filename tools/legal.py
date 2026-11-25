#!/usr/bin/env python3
"""Writes the privacy and terms pages (Spanish + English in one file each) into web/static/.

    python tools/legal.py

Edit the texts here, run it, rebuild. Plain static HTML: no script is needed to read them.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAIL = '<a href="mailto:webmaster@llmers.es">webmaster@llmers.es</a>'
UPDATED_ES, UPDATED_EN = "25 de noviembre de 2026", "25 November 2026"

HEAD = """<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0a0b0d">
<title>%(title)s · DailyClips</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  html { background: #0a0b0d; color: #f5f6f1; }
  body { font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; max-width: 640px; margin: 0 auto; padding: 28px 22px 80px; -webkit-font-smoothing: antialiased; }
  a { color: #b9f33f; }
  header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 30px; }
  header a.home { font-weight: 700; font-size: 19px; text-decoration: none; color: #f5f6f1; letter-spacing: -0.02em; }
  header a.home b { color: #b9f33f; }
  h1 { font-size: 30px; line-height: 1.1; letter-spacing: -0.02em; margin: 0 0 6px; }
  h2 { font-size: 18px; margin: 34px 0 8px; }
  p, li { color: #c9ccc2; }
  ul { padding-left: 20px; }
  li { margin: 6px 0; }
  .date { color: #8b8e85; font-size: 14px; margin: 0 0 22px; }
  strong { color: #f5f6f1; font-weight: 600; }
  [hidden] { display: none; }
</style>
</head>
<body>
<header><a class="home" href="/">Daily<b>Clips</b></a><a id="sw" href="?l=en">English</a></header>
"""

TAIL = """
<script>
  var en = /[?&]l=en/.test(location.search) || (!/[?&]l=es/.test(location.search) && !/^es/i.test(navigator.language || ''));
  document.getElementById('es').hidden = en;
  document.getElementById('en').hidden = !en;
  document.documentElement.lang = en ? 'en' : 'es';
  var sw = document.getElementById('sw');
  sw.textContent = en ? 'Español' : 'English';
  sw.href = en ? '?l=es' : '?l=en';
</script>
</body>
</html>
"""

PRIVACY_ES = f"""
<main id="es">
<h1>Privacidad</h1>
<p class="date">Última actualización: {UPDATED_ES}</p>
<p>El responsable de tus datos es DailyClips (llmers.es). Para cualquier cosa sobre ellos: {MAIL}.</p>

<h2>Qué se guarda</h2>
<ul>
<li><strong>Sin cuenta:</strong> un identificador aleatorio creado en tu navegador, tus resultados (nota del clip, nota de cada frase, nivel de nota y fecha) y un apodo generado, que es el que sale en el ranking. Nada de nombre ni correo.</li>
<li><strong>Si entras con Google (opcional):</strong> el identificador de tu cuenta de Google, tu correo y tu nombre de pila. En el ranking sale tu nombre de pila; lo puedes cambiar por el apodo en Cuenta.</li>
<li><strong>Si compras Pro:</strong> el identificador de cliente y de pago de Stripe y su estado. Los datos de la tarjeta los trata Stripe; aquí no llegan.</li>
</ul>

<h2>Tu voz</h2>
<ul>
<li><strong>Nivel web:</strong> el audio lo procesa el reconocedor de voz de tu navegador (en Chrome, Google; en Safari, Apple). DailyClips no recibe ni guarda tu audio. El texto reconocido se compara con la frase en tu navegador y no se envía.</li>
<li><strong>Nivel en el dispositivo:</strong> el audio se analiza en tu móvil y no sale de él.</li>
<li><strong>Nivel Pro:</strong> el audio de cada frase se envía a nuestro servidor, se puntúa en memoria y se descarta en cuanto sale la nota. No se escribe en disco, no se escucha y no se usa para entrenar nada.</li>
</ul>

<h2>Terceros</h2>
<ul>
<li><strong>YouTube:</strong> el vídeo lo sirve el reproductor de YouTube en modo de privacidad mejorada (youtube-nocookie.com). Al reproducirlo, YouTube recibe tu IP y puede usar su propio almacenamiento.</li>
<li><strong>Google:</strong> solo si usas el inicio de sesión.</li>
<li><strong>Stripe:</strong> solo si pagas Pro.</li>
<li><strong>Hugging Face y jsDelivr:</strong> solo si descargas el modelo del nivel en el dispositivo; ven tu IP al servirte los archivos.</li>
</ul>
<p>No hay publicidad, ni analítica, ni rastreadores. DailyClips no usa cookies propias; guarda tu progreso en el almacenamiento local del navegador. La IP se usa en memoria para limitar abusos y no se guarda.</p>

<h2>Dónde y cuánto tiempo</h2>
<p>Los datos están en un servidor en Alemania (Unión Europea). Se guardan hasta que los borres. Los perfiles anónimos sin actividad durante más de dos años se pueden eliminar.</p>

<h2>Tus derechos</h2>
<p>Puedes borrar todo en el momento desde <strong>Cuenta &rarr; Borrar mi cuenta y mis datos</strong>. También puedes pedir acceso, rectificación, portabilidad u oposición escribiendo a {MAIL}, y reclamar ante la autoridad de protección de datos de tu país (en España, la AEPD).</p>
<p>La base legal es prestarte el servicio que pides, tu consentimiento para el inicio de sesión opcional y el interés legítimo en evitar abusos. DailyClips no está pensado para menores de 16 años.</p>
</main>
"""

PRIVACY_EN = f"""
<main id="en" hidden>
<h1>Privacy</h1>
<p class="date">Last updated: {UPDATED_EN}</p>
<p>DailyClips (llmers.es) is responsible for your data. For anything about it: {MAIL}.</p>

<h2>What is stored</h2>
<ul>
<li><strong>Without an account:</strong> a random identifier created in your browser, your results (clip score, score of each line, scoring level and date) and a generated nickname, which is what appears on the ranking. No name, no email.</li>
<li><strong>If you sign in with Google (optional):</strong> your Google account identifier, your email and your first name. The ranking shows your first name; you can switch to the nickname in Account.</li>
<li><strong>If you buy Pro:</strong> the Stripe customer and payment identifiers and their status. Card details are handled by Stripe and never reach us.</li>
</ul>

<h2>Your voice</h2>
<ul>
<li><strong>Web level:</strong> the audio is processed by your browser's speech recogniser (Google in Chrome, Apple in Safari). DailyClips never receives or stores your audio. The recognised text is compared with the line inside your browser and is not sent anywhere.</li>
<li><strong>On-device level:</strong> the audio is analysed on your phone and never leaves it.</li>
<li><strong>Pro level:</strong> the audio of each line is sent to our server, scored in memory and discarded as soon as the score is out. It is not written to disk, not listened to and not used to train anything.</li>
</ul>

<h2>Third parties</h2>
<ul>
<li><strong>YouTube:</strong> the video is served by the YouTube player in privacy-enhanced mode (youtube-nocookie.com). When it plays, YouTube receives your IP address and may use its own storage.</li>
<li><strong>Google:</strong> only if you use sign-in.</li>
<li><strong>Stripe:</strong> only if you pay for Pro.</li>
<li><strong>Hugging Face and jsDelivr:</strong> only if you download the on-device model; they see your IP address when serving the files.</li>
</ul>
<p>There are no ads, no analytics and no trackers. DailyClips sets no cookies of its own; it keeps your progress in the browser's local storage. Your IP address is used in memory to limit abuse and is not stored.</p>

<h2>Where and for how long</h2>
<p>The data lives on a server in Germany (European Union). It is kept until you delete it. Anonymous profiles with no activity for more than two years may be removed.</p>

<h2>Your rights</h2>
<p>You can delete everything on the spot from <strong>Account &rarr; Delete my account and data</strong>. You can also ask for access, rectification, portability or objection by writing to {MAIL}, and complain to the data protection authority of your country.</p>
<p>The legal basis is providing the service you ask for, your consent for the optional sign-in, and the legitimate interest in preventing abuse. DailyClips is not intended for people under 16.</p>
</main>
"""

TERMS_ES = f"""
<main id="es">
<h1>Términos</h1>
<p class="date">Última actualización: {UPDATED_ES}</p>
<p>DailyClips es una web para practicar la pronunciación en inglés repitiendo frases de clips cortos. Contacto: {MAIL}.</p>

<h2>El servicio</h2>
<ul>
<li>Todo se puede usar gratis y sin cuenta. La nota es una estimación automática para practicar; no es un certificado ni una evaluación oficial.</li>
<li>Los tres niveles de nota usan la misma escala. Pagar no da más nota.</li>
<li>El servicio se ofrece tal cual. Puede cambiar, fallar o dejar de estar disponible; si se cierra, se avisará con antelación a quien tenga Pro.</li>
</ul>

<h2>Los vídeos</h2>
<p>Los vídeos son de sus autores y se reproducen con el reproductor integrado de YouTube, sin copiarlos ni alojarlos aquí. Al verlos se aplican también las condiciones de YouTube. Si eres titular de un vídeo y no quieres que aparezca, escribe a {MAIL} y se retira.</p>

<h2>Pro</h2>
<ul>
<li>Pro es un pago único de 4,99 € (impuestos incluidos) que se cobra con Stripe. No es una suscripción: no se renueva ni se vuelve a cobrar.</li>
<li>Pro queda ligado a tu cuenta mientras el servicio exista.</li>
<li>Si te arrepientes en los 14 días siguientes a la compra, escribe a {MAIL} y se te devuelve el importe.</li>
<li>Pro tiene un límite de uso razonable por persona para que el servidor aguante. Si el servidor está ocupado, la app usa el nivel gratuito que tengas disponible.</li>
</ul>

<h2>Uso correcto</h2>
<p>No automatices el envío de resultados, no intentes tumbar el servicio y no suplantes a nadie. Los resultados claramente falsos se pueden borrar del ranking.</p>

<h2>Responsabilidad</h2>
<p>En la medida en que la ley lo permite, DailyClips no responde de daños indirectos derivados del uso del servicio. Nada de esto te quita la protección que te dé la ley de consumo de tu país.</p>
</main>
"""

TERMS_EN = f"""
<main id="en" hidden>
<h1>Terms</h1>
<p class="date">Last updated: {UPDATED_EN}</p>
<p>DailyClips is a website to practise English pronunciation by repeating lines from short clips. Contact: {MAIL}.</p>

<h2>The service</h2>
<ul>
<li>Everything can be used for free and without an account. The score is an automatic estimate meant for practice; it is not a certificate or an official assessment.</li>
<li>The three scoring levels share one scale. Paying does not get you a higher score.</li>
<li>The service is provided as is. It may change, fail or stop being available; if it shuts down, people with Pro will be told in advance.</li>
</ul>

<h2>The videos</h2>
<p>Videos belong to their authors and are played with YouTube's embedded player; they are not copied or hosted here. YouTube's terms also apply when you watch them. If you own a video and do not want it shown, write to {MAIL} and it will be removed.</p>

<h2>Pro</h2>
<ul>
<li>Pro is a one-time payment of €4.99 (taxes included), charged through Stripe. It is not a subscription: it does not renew and you are not charged again.</li>
<li>Pro stays with your account for as long as the service exists.</li>
<li>If you change your mind within 14 days of the purchase, write to {MAIL} and you get a refund.</li>
<li>Pro has a reasonable per-person usage limit so the server can cope. If the server is busy, the app uses the free level you have available.</li>
</ul>

<h2>Fair use</h2>
<p>Do not automate result submissions, do not try to take the service down and do not impersonate anyone. Clearly fake results may be removed from the ranking.</p>

<h2>Liability</h2>
<p>To the extent the law allows, DailyClips is not liable for indirect damages arising from the use of the service. None of this takes away any protection your own country's consumer law gives you.</p>
</main>
"""

for name, title, body in (("privacy", "Privacidad", PRIVACY_ES + PRIVACY_EN), ("terms", "Términos", TERMS_ES + TERMS_EN)):
    out = ROOT / "web" / "static" / name / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(HEAD % {"title": title} + body + TAIL, encoding="utf-8")
    print("wrote", out.relative_to(ROOT))
