import { useCallback, useEffect, useRef, useState } from 'react'

/*
 * Cierre de sesión por inactividad del sistema interno.
 *
 * Solo cuenta la inactividad: mientras la persona use el mouse, el
 * teclado, haga clic, toque la pantalla o desplace la página, la
 * sesión no se cierra nunca. La última actividad se guarda en
 * localStorage, así que trabajar en cualquier pestaña cuenta para
 * todas. Unos minutos antes del cierre se muestra un aviso; mientras
 * está visible solo el botón "Seguir conectado" renueva la sesión,
 * para que mover el mouse sin querer no lo esconda.
 */

const CLAVE = 'casa-hogar:ultima-actividad'
const EVENTOS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel'] as const

function leerUltimaActividad() {
  try {
    const valor = Number(window.localStorage.getItem(CLAVE))
    return Number.isFinite(valor) && valor > 0 ? valor : null
  } catch {
    return null
  }
}

export function registrarActividad() {
  try {
    window.localStorage.setItem(CLAVE, String(Date.now()))
  } catch {
    // Sin localStorage (modo privado estricto) solo cuenta esta pestaña.
  }
}

type Opciones = {
  activo: boolean
  minutos: number
  avisoSegundos: number
  alCerrar: () => void
}

export function useCierrePorInactividad({ activo, minutos, avisoSegundos, alCerrar }: Opciones) {
  const [segundosRestantes, setSegundosRestantes] = useState<number | null>(null)

  const ultimaLocal = useRef(0)
  const avisoVisible = useRef(false)
  const alCerrarRef = useRef(alCerrar)

  useEffect(() => {
    alCerrarRef.current = alCerrar
  }, [alCerrar])

  const seguirConectado = useCallback(() => {
    ultimaLocal.current = Date.now()
    registrarActividad()
    avisoVisible.current = false
    setSegundosRestantes(null)
  }, [])

  useEffect(() => {
    if (!activo) return

    const limite = minutos * 60_000

    // Al entrar (o recargar) cuenta como actividad, salvo que la última
    // registrada ya supere el límite: entonces se cierra de inmediato.
    const guardada = leerUltimaActividad()
    if (guardada === null || Date.now() - guardada < limite) {
      ultimaLocal.current = Date.now()
      registrarActividad()
    } else {
      ultimaLocal.current = guardada
    }

    let ultimaEscritura = 0

    function alActuar() {
      if (avisoVisible.current) return

      const ahora = Date.now()
      ultimaLocal.current = ahora

      // Escribir en localStorage como mucho cada 5 s
      if (ahora - ultimaEscritura > 5000) {
        ultimaEscritura = ahora
        registrarActividad()
      }
    }

    function revisar() {
      const ultima = Math.max(leerUltimaActividad() ?? 0, ultimaLocal.current)
      const restante = limite - (Date.now() - ultima)

      if (restante <= 0) {
        avisoVisible.current = false
        setSegundosRestantes(null)
        alCerrarRef.current()
        return
      }

      if (restante <= avisoSegundos * 1000) {
        avisoVisible.current = true
        setSegundosRestantes(Math.ceil(restante / 1000))
      } else if (avisoVisible.current) {
        // Otra pestaña registró actividad: se quita el aviso aquí también.
        avisoVisible.current = false
        setSegundosRestantes(null)
      }
    }

    for (const evento of EVENTOS) {
      window.addEventListener(evento, alActuar, { passive: true })
    }

    // Al volver a la pestaña (o despertar la computadora) se revisa al instante.
    document.addEventListener('visibilitychange', revisar)
    const intervalo = window.setInterval(revisar, 1000)
    const primera = window.setTimeout(revisar, 0)

    return () => {
      for (const evento of EVENTOS) {
        window.removeEventListener(evento, alActuar)
      }
      document.removeEventListener('visibilitychange', revisar)
      window.clearInterval(intervalo)
      window.clearTimeout(primera)
      avisoVisible.current = false
    }
  }, [activo, minutos, avisoSegundos])

  return {
    segundosRestantes: activo ? segundosRestantes : null,
    seguirConectado,
  }
}
