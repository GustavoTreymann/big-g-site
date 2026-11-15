// Confere se o canal está ao vivo e grava o resultado em live.json.
//
// Com a variável YT_API_KEY definida, usa a YouTube Data API v3 (2 unidades de cota
// por rodada; a cada 5 minutos dá ~576 das 10.000 unidades diárias gratuitas).
// Sem a chave, lê a página pública youtube.com/channel/ID/live (raspagem).
//
// Uso: node checar-live.mjs [caminho/do/live.json]
import { readFileSync, writeFileSync } from 'node:fs'

const CANAL = process.env.CANAL || 'UCMhRdSNCUmH9JHDGk3ZLNeA'
const CHAVE = process.env.YT_API_KEY || ''
const ARQUIVO = process.argv[2] || 'live.json'

// Devolve { aoVivo, videoId, titulo } ou null quando não deu para saber
async function pelaApi() {
  const api = async (recurso, params) => {
    const url = `https://www.googleapis.com/youtube/v3/${recurso}?${new URLSearchParams({ ...params, key: CHAVE })}`
    const r = await fetch(url)
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`${recurso}: HTTP ${r.status} ${d.error?.message || ''}`.trim())
    return d
  }
  // A playlist de envios do canal (UC... vira UU...) lista os vídeos mais recentes,
  // incluindo a live em andamento. Custa 1 unidade; a busca por lives custaria 100.
  const envios = await api('playlistItems', { part: 'contentDetails', playlistId: 'UU' + CANAL.slice(2), maxResults: '10' })
  const ids = (envios.items || []).map((i) => i.contentDetails.videoId)
  if (!ids.length) return { aoVivo: false, videoId: null, titulo: null }
  const videos = await api('videos', { part: 'snippet', id: ids.join(',') })
  const live = (videos.items || []).find((v) => v.snippet.liveBroadcastContent === 'live')
  return live ? { aoVivo: true, videoId: live.id, titulo: live.snippet.title } : { aoVivo: false, videoId: null, titulo: null }
}

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

async function pelaPagina() {
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
  if (!bruto) {
    // Sem dados do player. Página normal = canal sem live nem live agendada.
    if (!resposta.ok || !html.includes('ytInitialData')) throw new Error(`página inesperada (HTTP ${resposta.status})`)
    return { aoVivo: false, videoId: null, titulo: null }
  }
  const d = JSON.parse(bruto).videoDetails || {}
  const aoVivo = d.isLive === true && !d.isUpcoming && d.channelId === CANAL
  return { aoVivo, videoId: aoVivo ? d.videoId : null, titulo: aoVivo ? d.title : null }
}

const metodo = CHAVE ? 'API' : 'página pública'
let novo
try {
  novo = await (CHAVE ? pelaApi() : pelaPagina())
} catch (erro) {
  // Falhou: mantém o status anterior em vez de chutar. O aviso aparece na rodada do GitHub.
  console.log(`::warning::Não deu para conferir pela ${metodo}: ${erro.message}`)
  process.exit(0)
}

let antigo = {}
try { antigo = JSON.parse(readFileSync(ARQUIVO, 'utf8')) } catch {}
if (antigo.aoVivo === novo.aoVivo && antigo.videoId === novo.videoId) {
  console.log(`[${metodo}] Sem mudança: ${novo.aoVivo ? 'ao vivo' : 'offline'}.`)
} else {
  writeFileSync(ARQUIVO, JSON.stringify({ ...novo, mudouEm: new Date().toISOString() }) + '\n')
  console.log(`[${metodo}] Mudou para ${novo.aoVivo ? 'AO VIVO: ' + novo.videoId : 'offline'}.`)
}
