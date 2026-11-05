import { useEffect } from 'react'

// Sistema interno: los avisos y los paneles (detalle, historial o formulario)
// suelen aparecer arriba de la tabla. Si uno aparece fuera de la vista, se
// sube hasta él; si ya se ve, no se mueve.

const AVISOS = '.movement-success, .success-message, .inventory-error, .error-message'

// Solo cuentan si se abren por sí solos: los que ya vienen dentro de un módulo
// recién cargado no deben mover la pantalla.
const PANELES = '.history-detail-card, .soporte-detalle, .soporte-form, .cash-card.cash-form, .product-form-card, .clients-form-card, .quotes-form-card, .returns-form-card, .movement-form-card'

const ALTO_BARRA = 80

function avisoDe(nodo: Node): Element | null {
  const elemento = nodo instanceof Element ? nodo : nodo.parentElement
  if (!elemento) return null

  return elemento.closest(AVISOS) ?? elemento.querySelector(AVISOS)
}

function panelFueraDeVista(nodo: Node): Element | null {
  if (!(nodo instanceof Element) || !nodo.matches(PANELES)) return null

  const { top } = nodo.getBoundingClientRect()

  return top < ALTO_BARRA || top > window.innerHeight - ALTO_BARRA ? nodo : null
}

export function useMostrarAvisos() {
  useEffect(() => {
    const observador = new MutationObserver(cambios => {
      for (const cambio of cambios) {
        const nodos = cambio.type === 'characterData' ? [cambio.target] : Array.from(cambio.addedNodes)

        for (const nodo of nodos) {
          const aviso = avisoDe(nodo)

          if (aviso) {
            aviso.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
            return
          }

          const panel = panelFueraDeVista(nodo)

          if (panel) {
            panel.scrollIntoView({ behavior: 'smooth', block: 'start' })
            return
          }
        }
      }
    })

    observador.observe(document.body, { childList: true, subtree: true, characterData: true })

    return () => observador.disconnect()
  }, [])
}
