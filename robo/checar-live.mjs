// Confere se o canal está ao vivo lendo a página pública youtube.com/channel/ID/live
// e grava o resultado em live.json. Não usa chave de API nem login.
// Uso: node checar-live.mjs [caminho/do/live.json]
import { readFileSync, writeFileSync } from 'node:fs'

const CANAL = process.env.CANAL || 'UCMhRdSNCUmH9JHDGk3ZLNeA'
const ARQUIVO = process.argv[2] || 'live.json'

// Recorta o objeto JSON que começa em `inicio`, respeitando chaves dentro de strings
function recortarJson(texto, inicio) {
  let nivel = 0, emTexto = false, escape = false
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i]
    if (emTexto) {
      if (escape) escape = false
      else if (c === '\\') escape = true
      else if (c === '"') emTexto = false
    } else if (c === '"') emTexto = true
    else if (c === '{') nivel++
    else if (c === '}' && --nivel === 0) return texto.slice(inicio, i + 1)
  }
  return null
}

const resposta = await fetch(`https://www.youtube.com/channel/${CANAL}/live`, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    'Accept-Language': 'en',
    Cookie: 'CONSENT=YES+1', // pula a tela de consentimento de cookies
  },
})
const html = await resposta.text()
const marca = html.indexOf('ytInitialPlayerResponse')
const chave = marca < 0 ? -1 : html.indexOf('{', marca)
const bruto = chave < 0 ? null : recortarJson(html, chave)

let novo
if (!bruto) {
  // Sem dados do player. Se a página veio normal, o canal não tem live nem live agendada.
  // Se veio outra coisa (bloqueio, consentimento), não mexe no arquivo.
  if (!resposta.ok || !html.includes('ytInitialData')) {
    console.log(`Página inesperada (HTTP ${resposta.status}); mantendo o status anterior.`)
    process.exit(0)
  }
  novo = { aoVivo: false, videoId: null, titulo: null }
} else {
  const d = JSON.parse(bruto).videoDetails || {}
  const aoVivo = d.isLive === true && !d.isUpcoming && d.channelId === CANAL
  novo = { aoVivo, videoId: aoVivo ? d.videoId : null, titulo: aoVivo ? d.title : null }
}

let antigo = {}
try { antigo = JSON.parse(readFileSync(ARQUIVO, 'utf8')) } catch {}
if (antigo.aoVivo === novo.aoVivo && antigo.videoId === novo.videoId) {
  console.log(`Sem mudança: ${novo.aoVivo ? 'ao vivo' : 'offline'}.`)
} else {
  writeFileSync(ARQUIVO, JSON.stringify({ ...novo, mudouEm: new Date().toISOString() }) + '\n')
  console.log(`Mudou para ${novo.aoVivo ? 'AO VIVO: ' + novo.videoId : 'offline'}.`)
}
