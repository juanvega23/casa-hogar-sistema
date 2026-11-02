import { useEffect, useState } from 'react'

import { supabaseTienda } from './supabase'

// Ficha de producto (características, medidas, uso, áreas) y productos
// relacionados, leídos de detalles_catalogo_publico() para la tienda.

export type DetalleProducto = {
  caracteristicas: string[]
  dimensiones: { etiqueta: string, valor: string }[]
  modoUso: string | null
  areas: string[]
  relacionados: number[]
}

// Una por línea; se quitan viñetas escritas a mano ("-", "•", "*")
export function lineasFicha(texto: string | null | undefined) {
  return (texto ?? '')
    .split(/\r?\n/)
    .map(linea => linea.replace(/^\s*[-•*]\s*/, '').trim())
    .filter(Boolean)
}

// "Largo: 25 cm" → { etiqueta: 'Largo', valor: '25 cm' }
export function medidasFicha(texto: string | null | undefined) {
  return lineasFicha(texto).map(linea => {
    const separador = linea.indexOf(':')
    return separador > 0
      ? { etiqueta: linea.slice(0, separador).trim(), valor: linea.slice(separador + 1).trim() }
      : { etiqueta: '', valor: linea }
  })
}

type FilaDetalle = {
  producto_id: number
  caracteristicas: string | null
  dimensiones: string | null
  modo_uso: string | null
  areas: string[] | null
  relacionados: number[] | null
}

export function useDetallesCatalogo() {
  const [detalles, setDetalles] = useState<Record<number, DetalleProducto>>({})

  useEffect(() => {
    let vigente = true

    void supabaseTienda.rpc('detalles_catalogo_publico').then(({ data, error }) => {
      // Sin la migración o con error, la tienda funciona sin fichas
      if (!vigente || error) return

      const mapa: Record<number, DetalleProducto> = {}

      for (const fila of (data ?? []) as FilaDetalle[]) {
        mapa[Number(fila.producto_id)] = {
          caracteristicas: lineasFicha(fila.caracteristicas),
          dimensiones: medidasFicha(fila.dimensiones),
          modoUso: fila.modo_uso?.trim() || null,
          areas: fila.areas ?? [],
          relacionados: (fila.relacionados ?? []).map(Number),
        }
      }

      setDetalles(mapa)
    })

    return () => {
      vigente = false
    }
  }, [])

  return detalles
}
