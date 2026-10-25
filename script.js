// ============================================================
//  CONFIGURACIÓN
//  La URL de la API se escribe en el apartado "CONFIGURACIÓN DE LA API"
//  al final de la página y se guarda en el navegador.
//  Si quieres dejarla fija para todos, escríbela aquí:
//  Ejemplo: "https://mi-api-robot.onrender.com/api"
// ============================================================
const API_POR_DEFECTO = "";

// Rutas que debe exponer tu API REST
const RUTA_COMANDO = "/comando";     // POST { "accion": "izquierda" | "derecha" | "detener" }
const RUTA_MODO = "/modo";           // POST { "modo": "manual" | "automatico" }
const RUTA_DISTANCIA = "/distancia"; // GET  -> { "distancia": 123, "modo": "manual" }  (modo es opcional)

const INTERVALO_MS = 1000;       // cada cuánto se consulta la distancia
const TIMEOUT_MS = 4000;         // tiempo máximo de espera por petición
const DISTANCIA_PELIGRO = 20;    // cm: obstáculo muy cerca (rojo)
const DISTANCIA_PRECAUCION = 50; // cm: precaución (ámbar)
const DISTANCIA_MAX = 200;       // cm: a esta distancia o más la barra queda vacía

const CLAVE_URL = "robot_api_url";
const CLAVE_KEY = "robot_api_clave";

// ---------- Elementos ----------
const display = document.getElementById("display");
const relleno = document.getElementById("relleno");
const proximidad = document.getElementById("proximidad");
const punto = document.getElementById("punto");
const textoEstado = document.getElementById("textoEstado");
const ultimoComando = document.getElementById("ultimoComando");
const btnManual = document.getElementById("btnManual");
const btnAuto = document.getElementById("btnAuto");
const etiquetaModo = document.getElementById("etiquetaModo");
const controles = document.getElementById("controles");
const botonesMovimiento = document.querySelectorAll("[data-mov]");

const formConfig = document.getElementById("formConfig");
const inputUrl = document.getElementById("inputUrl");
const inputClave = document.getElementById("inputClave");
const btnVerClave = document.getElementById("btnVerClave");
const btnProbar = document.getElementById("btnProbar");
const btnBorrar = document.getElementById("btnBorrar");
const configMensaje = document.getElementById("configMensaje");

// ---------- Estado ----------
let modo = "manual";
let ultimoCambioModo = 0;
let apiBase = "";   // URL de la API (sin "/" al final). Vacío = sin configurar
let apiClave = "";  // Clave opcional

const sinApi = () => {
  if (apiBase) return false;
  setEstado("error", "API no configurada");
  return true;
};

// ---------- Almacenamiento (si el navegador lo bloquea, la página sigue funcionando) ----------
function leerGuardado(clave) {
  try { return localStorage.getItem(clave) || ""; } catch (e) { return ""; }
}
function guardar(clave, valor) {
  try { localStorage.setItem(clave, valor); return true; } catch (e) { return false; }
}
function borrarGuardado(clave) {
  try { localStorage.removeItem(clave); } catch (e) { /* nada */ }
}

// ---------- Utilidades ----------
function setEstado(tipo, texto) {
  punto.className = "punto " + tipo;
  textoEstado.textContent = texto;
}

function normalizarUrl(texto) {
  return texto.trim().replace(/\/+$/, "");
}

function urlValida(texto) {
  try {
    const u = new URL(texto);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch (e) {
    return false;
  }
}

async function peticion(ruta, opciones = {}) {
  const control = new AbortController();
  const t = setTimeout(() => control.abort(), TIMEOUT_MS);
  try {
    const cabeceras = { ...(opciones.headers || {}) };
    if (apiClave) cabeceras["x-functions-key"] = apiClave; // clave de Azure Functions
    const resp = await fetch(apiBase + ruta, { ...opciones, headers: cabeceras, signal: control.signal });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    return await resp.json().catch(() => ({}));
  } finally {
    clearTimeout(t);
  }
}

function enviarJSON(ruta, cuerpo) {
  return peticion(ruta, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo)
  });
}

// ---------- Modo manual / automático ----------
function aplicarModoEnPantalla(m) {
  modo = m;
  const auto = m === "automatico";
  btnManual.classList.toggle("activo", !auto);
  btnAuto.classList.toggle("activo", auto);
  etiquetaModo.textContent = "Modo actual: " + (auto ? "AUTOMÁTICO" : "MANUAL");
  botonesMovimiento.forEach(b => { b.disabled = auto; });
  controles.classList.toggle("bloqueado", auto);
}

async function cambiarModo(nuevo) {
  if (nuevo === modo) return;
  if (sinApi()) return;
  const anterior = modo;
  aplicarModoEnPantalla(nuevo);
  ultimoCambioModo = Date.now();
  if (nuevo === "automatico") ultimoComando.textContent = "AUTOMÁTICO";

  try {
    await enviarJSON(RUTA_MODO, { modo: nuevo });
    setEstado("ok", "Conectado");
  } catch (e) {
    aplicarModoEnPantalla(anterior); // si falló, no mostramos un modo falso
    setEstado("error", "No se pudo cambiar el modo");
    console.error(e);
  }
}

btnManual.addEventListener("click", () => cambiarModo("manual"));
btnAuto.addEventListener("click", () => cambiarModo("automatico"));

// ---------- Comandos manuales ----------
async function enviarComando(accion) {
  // En modo automático solo se permite DETENER
  if (modo === "automatico" && accion !== "detener") return;

  if (sinApi()) return;

  ultimoComando.textContent = accion.toUpperCase();

  try {
    await enviarJSON(RUTA_COMANDO, { accion });
    setEstado("ok", "Conectado");
  } catch (e) {
    setEstado("error", "No se pudo enviar el comando");
    console.error(e);
  }

  // DETENER en modo automático = parada de emergencia y vuelta a manual
  if (accion === "detener" && modo === "automatico") cambiarModo("manual");
}

document.querySelectorAll("[data-accion]").forEach(btn => {
  btn.addEventListener("click", () => enviarComando(btn.dataset.accion));
});

// Atajos de teclado: ← → y barra espaciadora (no se activan mientras se escribe en un campo)
document.addEventListener("keydown", e => {
  const el = document.activeElement;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
  if (e.key === "ArrowLeft") enviarComando("izquierda");
  if (e.key === "ArrowRight") enviarComando("derecha");
  if (e.key === " ") { e.preventDefault(); enviarComando("detener"); }
});

// ---------- Distancia y proximidad ----------
function mostrarDistancia(cm) {
  relleno.className = "relleno";
  proximidad.className = "proximidad";

  if (cm === null || cm === undefined || isNaN(cm)) {
    display.textContent = "---";
    display.classList.remove("alerta");
    relleno.style.width = "0%";
    proximidad.textContent = "Sin lectura";
    return;
  }

  const valor = Math.round(cm);
  display.textContent = String(valor).padStart(3, "0");

  // La barra se llena a medida que el obstáculo se acerca
  const porcentaje = Math.max(0, Math.min(100, (1 - valor / DISTANCIA_MAX) * 100));
  relleno.style.width = porcentaje + "%";

  if (valor <= DISTANCIA_PELIGRO) {
    display.classList.add("alerta");
    relleno.classList.add("peligro");
    proximidad.classList.add("peligro");
    proximidad.textContent = "¡OBSTÁCULO MUY CERCA!";
  } else if (valor <= DISTANCIA_PRECAUCION) {
    display.classList.remove("alerta");
    relleno.classList.add("precaucion");
    proximidad.classList.add("precaucion");
    proximidad.textContent = "PRECAUCIÓN";
  } else {
    display.classList.remove("alerta");
    proximidad.classList.add("libre");
    proximidad.textContent = "CAMINO LIBRE";
  }
}

async function actualizarDistancia() {
  if (sinApi()) {
    mostrarDistancia(null);
    return;
  }

  try {
    const datos = await peticion(RUTA_DISTANCIA);
    mostrarDistancia(datos.distancia);

    // Si la API informa el modo, se sincroniza (salvo justo después de que el usuario lo cambió)
    const pasoTiempo = Date.now() - ultimoCambioModo > 3000;
    if (pasoTiempo && (datos.modo === "manual" || datos.modo === "automatico") && datos.modo !== modo) {
      aplicarModoEnPantalla(datos.modo);
    }
    setEstado("ok", "Conectado");
  } catch (e) {
    mostrarDistancia(null);
    setEstado("error", "Sin conexión con la API");
  }
}

// ---------- Apartado de configuración de la API ----------
function mensajeConfig(tipo, texto) {
  configMensaje.className = "config-mensaje " + tipo;
  configMensaje.textContent = texto;
}

// Un sitio https no puede llamar a una API http (el navegador lo bloquea)
function avisoMixto(url) {
  return location.protocol === "https:" && url.startsWith("http://");
}

function leerFormulario() {
  const url = normalizarUrl(inputUrl.value);
  if (!url) {
    mensajeConfig("error", "Escribe la URL de tu API.");
    inputUrl.focus();
    return null;
  }
  if (!urlValida(url)) {
    mensajeConfig("error", "La URL no es válida. Debe empezar con http:// o https://");
    inputUrl.focus();
    return null;
  }
  return { url, clave: inputClave.value.trim() };
}

async function probarConexion(url, clave) {
  const anteriorBase = apiBase;
  const anteriorClave = apiClave;
  apiBase = url;
  apiClave = clave;
  try {
    const datos = await peticion(RUTA_DISTANCIA);
    return { ok: true, datos };
  } catch (e) {
    return { ok: false, error: e };
  } finally {
    apiBase = anteriorBase;
    apiClave = anteriorClave;
  }
}

btnProbar.addEventListener("click", async () => {
  const cfg = leerFormulario();
  if (!cfg) return;
  if (avisoMixto(cfg.url)) {
    mensajeConfig("aviso", "Esta página está en https y tu API en http: el navegador la bloqueará. Usa una API con https.");
    return;
  }
  mensajeConfig("", "Probando conexión...");
  const r = await probarConexion(cfg.url, cfg.clave);
  if (r.ok && r.datos && r.datos.distancia !== undefined) {
    mensajeConfig("ok", "¡Conexión correcta! La API respondió con distancia: " + r.datos.distancia + " cm.");
  } else if (r.ok) {
    mensajeConfig("aviso", "La API respondió, pero no devolvió el campo \"distancia\". Revisa la ruta GET /distancia.");
  } else {
    mensajeConfig("error", "No se pudo conectar. Revisa la URL, la clave y que la API permita CORS desde este sitio.");
  }
});

formConfig.addEventListener("submit", async e => {
  e.preventDefault();
  const cfg = leerFormulario();
  if (!cfg) return;

  apiBase = cfg.url;
  apiClave = cfg.clave;

  const guardado = guardar(CLAVE_URL, cfg.url) && guardar(CLAVE_KEY, cfg.clave);
  const sufijo = guardado ? "" : " (no se pudo guardar en este navegador; tendrás que escribirla otra vez al recargar)";

  if (avisoMixto(cfg.url)) {
    mensajeConfig("aviso", "Guardado, pero esta página está en https y tu API en http: el navegador la bloqueará." + sufijo);
  } else {
    mensajeConfig("ok", "API guardada. Conectando..." + sufijo);
  }

  await actualizarDistancia();
});

btnBorrar.addEventListener("click", () => {
  borrarGuardado(CLAVE_URL);
  borrarGuardado(CLAVE_KEY);
  apiBase = "";
  apiClave = "";
  inputUrl.value = "";
  inputClave.value = "";
  mensajeConfig("ok", "Configuración borrada. Ingresa una nueva URL para volver a conectar.");
  actualizarDistancia();
});

btnVerClave.addEventListener("click", () => {
  const oculta = inputClave.type === "password";
  inputClave.type = oculta ? "text" : "password";
  btnVerClave.textContent = oculta ? "OCULTAR" : "VER";
});

// ---------- Inicio ----------
function iniciar() {
  apiBase = normalizarUrl(leerGuardado(CLAVE_URL) || API_POR_DEFECTO);
  apiClave = leerGuardado(CLAVE_KEY);
  inputUrl.value = apiBase;
  inputClave.value = apiClave;

  aplicarModoEnPantalla("manual");
  actualizarDistancia();
  setInterval(actualizarDistancia, INTERVALO_MS);
}

iniciar();
