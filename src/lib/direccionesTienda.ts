import { useCallback, useEffect, useState } from 'react'

import { supabaseTienda as supabase } from './supabase'

// Libreta de direcciones del cliente (direcciones_cliente; RLS: solo las propias)

export type DireccionCliente = {
  id: number
  alias: string
  direccion: string
  referencia: string | null
}

export function useDirecciones(activo: boolean) {
  const [direcciones, setDirecciones] = useState<DireccionCliente[]>([])

  const pedir = useCallback(
    () =>
      supabase
        .from('direcciones_cliente')
        .select('id, alias, direccion, referencia')
        .order('created_at', { ascending: true })
        .then(({ data }) => setDirecciones((data ?? []) as DireccionCliente[])),
    [],
  )

  useEffect(() => {
    if (activo) void pedir()
  }, [activo, pedir])

  return { direcciones, recargar: pedir }
}

export async function guardarDireccion(alias: string, direccion: string, referencia: string) {
  const { error } = await supabase.from('direcciones_cliente').insert({
    alias: alias.trim(),
    direccion: direccion.trim(),
    referencia: referencia.trim() || null,
  })

  return error ? error.message : null
}

export async function actualizarDireccion(id: number, alias: string, direccion: string, referencia: string) {
  const { error } = await supabase
    .from('direcciones_cliente')
    .update({
      alias: alias.trim(),
      direccion: direccion.trim(),
      referencia: referencia.trim() || null,
    })
    .eq('id', id)

  return error ? error.message : null
}

export async function borrarDireccion(id: number) {
  const { error } = await supabase.from('direcciones_cliente').delete().eq('id', id)
  return error ? error.message : null
}

export function textoDireccion(d: DireccionCliente) {
  return d.referencia ? `${d.direccion} (${d.referencia})` : d.direccion
}
