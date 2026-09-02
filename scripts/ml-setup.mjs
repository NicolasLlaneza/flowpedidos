#!/usr/bin/env node
// =============================================================================
// ml-setup.mjs · Bloque C-ML
// -----------------------------------------------------------------------------
// Deja Mercado Libre listo para la corrida definitiva:
//   1. Flujo OAuth guiado — imprime la URL de autorización, pide el `code`
//      que ML devuelve y hace el intercambio por access_token + refresh_token.
//      Persiste ambos en .env.
//   2. Crea dos test users (comprador y vendedor) vía POST /users/test_user.
//   3. Persiste sus credenciales en scripts/.ml-testusers.json (git-ignored).
//
// Uso:
//   node scripts/ml-setup.mjs                    # flujo completo interactivo
//   node scripts/ml-setup.mjs --skip-oauth       # sólo crear test users
//   node scripts/ml-setup.mjs --refresh          # renueva access_token
//
// Requiere en .env: ML_APP_CLIENT_ID, ML_APP_CLIENT_SECRET
// Genera en .env: ML_ACCESS_TOKEN, ML_REFRESH_TOKEN
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH  = path.join(__dirname, '..', '.env');
process.loadEnvFile(ENV_PATH);

const ARGS = new Set(process.argv.slice(2));

const CLIENT_ID     = process.env.ML_APP_CLIENT_ID;
const CLIENT_SECRET = process.env.ML_APP_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('Faltan ML_APP_CLIENT_ID o ML_APP_CLIENT_SECRET en .env');
    console.error('Ver scripts/README.md Paso 1 (crear app en developers.mercadolibre.com.ar)');
    process.exit(1);
}

// Redirect URI de la app — DEBE coincidir con la configurada en developers.mercadolibre.com.ar
const REDIRECT_URI = 'http://localhost:5678/rest/oauth2-credential/callback';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

// -----------------------------------------------------------------------------
// Persistencia de .env — actualiza líneas KEY=VALUE existentes o las agrega
// -----------------------------------------------------------------------------
function persistEnvVars(vars) {
    let content = fs.readFileSync(ENV_PATH, 'utf8');
    for (const [k, v] of Object.entries(vars)) {
        const line = `${k}=${v}`;
        const re = new RegExp(`^${k}=.*$`, 'm');
        if (re.test(content)) content = content.replace(re, line);
        else content = content.trimEnd() + `\n${line}\n`;
        process.env[k] = v;
    }
    fs.writeFileSync(ENV_PATH, content);
    console.log(`  → .env actualizado (${Object.keys(vars).join(', ')})`);
}

// -----------------------------------------------------------------------------
// OAuth
// -----------------------------------------------------------------------------
async function oauthFlow() {
    const authUrl = 'https://auth.mercadolibre.com.ar/authorization?' +
        `response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    console.log('\n1. Abrí esta URL en una ventana privada (con tu cuenta ML real):');
    console.log('   ' + authUrl);
    console.log('\n2. Autorizá la app. Vas a ser redirigido a una URL de localhost:5678');
    console.log('   que probablemente muestre un error de "no encontrado" — es esperable.');
    console.log('   De esa URL copiá el valor del parámetro ?code=');
    const code = (await ask('\n   Pegá el code: ')).trim();
    if (!code) { console.error('code vacío'); process.exit(1); }

    console.log('\nintercambiando code por access_token...');
    const r = await fetch('https://api.mercadolibre.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code,
            redirect_uri: REDIRECT_URI,
        }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`token exchange ${r.status}: ${JSON.stringify(data).slice(0, 300)}`);

    console.log(`  → access_token obtenido (expira en ${data.expires_in}s), refresh_token guardado`);
    persistEnvVars({
        ML_ACCESS_TOKEN:  data.access_token,
        ML_REFRESH_TOKEN: data.refresh_token,
    });
    return data.access_token;
}

async function refreshToken() {
    const refresh = process.env.ML_REFRESH_TOKEN;
    if (!refresh) { console.error('No hay ML_REFRESH_TOKEN — correr sin --refresh primero'); process.exit(1); }
    console.log('renovando access_token vía refresh_token...');
    const r = await fetch('https://api.mercadolibre.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            refresh_token: refresh,
        }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`refresh ${r.status}: ${JSON.stringify(data)}`);
    persistEnvVars({
        ML_ACCESS_TOKEN:  data.access_token,
        ML_REFRESH_TOKEN: data.refresh_token,
    });
    console.log(`  → renovado (expira en ${data.expires_in}s)`);
    return data.access_token;
}

// -----------------------------------------------------------------------------
// Test users
// -----------------------------------------------------------------------------
async function createTestUser(token, siteId = 'MLA') {
    const r = await fetch('https://api.mercadolibre.com/users/test_user', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: siteId }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`create test user ${r.status}: ${JSON.stringify(data)}`);
    return data;
}

async function createTestUsers(token) {
    console.log('\ncreando test user vendedor (MLA)...');
    const seller = await createTestUser(token);
    console.log(`  → id=${seller.id} nickname=${seller.nickname} email=${seller.email}`);

    console.log('creando test user comprador (MLA)...');
    const buyer = await createTestUser(token);
    console.log(`  → id=${buyer.id} nickname=${buyer.nickname} email=${buyer.email}`);

    const record = {
        created_at: new Date().toISOString(),
        seller: { id: seller.id, nickname: seller.nickname, password: seller.password, email: seller.email, site_status: seller.site_status },
        buyer:  { id: buyer.id,  nickname: buyer.nickname,  password: buyer.password,  email: buyer.email,  site_status: buyer.site_status  },
    };
    const outPath = path.join(__dirname, '.ml-testusers.json');
    fs.writeFileSync(outPath, JSON.stringify(record, null, 2));
    console.log(`  → credenciales persistidas en ${outPath} (git-ignored)`);
    return record;
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
async function main() {
    let token;
    if (ARGS.has('--refresh')) {
        token = await refreshToken();
        console.log('\nlisto — access_token renovado');
        rl.close();
        return;
    }

    if (ARGS.has('--skip-oauth')) {
        token = process.env.ML_ACCESS_TOKEN;
        if (!token) { console.error('No hay ML_ACCESS_TOKEN — ejecutar sin --skip-oauth'); process.exit(1); }
        console.log('usando ML_ACCESS_TOKEN existente');
    } else {
        token = await oauthFlow();
    }

    const users = await createTestUsers(token);

    console.log('\nlisto · próximos pasos manuales (ver scripts/README.md Paso 4):');
    console.log('  1. Login al comprador en ventana privada:');
    console.log(`     nickname=${users.buyer.nickname} password=${users.buyer.password}`);
    console.log('  2. Comprar una publicación del vendedor:');
    console.log(`     nickname=${users.seller.nickname} password=${users.seller.password}`);
    console.log('  3. Verificar el POST entrante en http://localhost:4040 (ngrok inspector)');
    console.log('     y la fila resultante en tfi.orders (channel=mercadolibre)');
    rl.close();
}

main().catch(err => { console.error(err.message); rl.close(); process.exit(1); });
