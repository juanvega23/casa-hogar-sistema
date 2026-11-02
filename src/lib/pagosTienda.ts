import { useEffect, useState } from 'react'

import { supabaseTienda as supabase } from './supabase'

/*
 * Pagos de los pedidos de la tienda.
 *
 * - Transferencia: el cliente elige banco y cuenta (cuentas_bancarias,
 *   administradas por Caja) y sube el comprobante al bucket privado
 *   "comprobantes" en su carpeta (<uid>/...). Caja lo valida.
 * - Tarjeta: pasarela SIMULADA (pagar_pedido_web_tarjeta). Aquí solo
 *   se revisa el formato antes de enviar; la base decide si se aprueba
 *   y nunca guarda el número completo.
 */

export type CuentaBancaria = {
  id: number
  banco: string
  titular: string
  numero: string
  moneda: 'NIO' | 'USD'
  tipo_cuenta: string
}

export type DatosTarjeta = {
  nombre: string
  numero: string
  vence: string
  cvv: string
}

export const TARJETA_VACIA: DatosTarjeta = { nombre: '', numero: '', vence: '', cvv: '' }

export const TIPOS_COMPROBANTE = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
export const MAXIMO_COMPROBANTE = 5 * 1024 * 1024

// Cuentas activas y tipo de cambio (solo con sesión de cliente)
export function useCuentasBancarias(activo: boolean) {
  const [cuentas, setCuentas] = useState<CuentaBancaria[]>([])
  const [tipoCambio, setTipoCambio] = useState<number | null>(null)

  useEffect(() => {
    if (!activo) return

    void supabase
      .from('cuentas_bancarias')
      .select('id, banco, titular, numero, moneda, tipo_cuenta')
      .eq('activa', true)
      .order('orden', { ascending: true })
      .then(({ data }) => setCuentas((data ?? []) as CuentaBancaria[]))

    void supabase
      .from('parametros_negocio')
      .select('tipo_cambio_usd')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => setTipoCambio(data ? Number(data.tipo_cambio_usd) : null))
  }, [activo])

  return { cuentas, tipoCambio }
}

export function errorComprobante(archivo: File | null): string | null {
  if (!archivo) return 'Adjuntá la foto o el PDF del comprobante de la transferencia.'
  if (!TIPOS_COMPROBANTE.includes(archivo.type)) return 'El comprobante debe ser una imagen (JPG, PNG o WebP) o un PDF.'
  if (archivo.size > MAXIMO_COMPROBANTE) return 'El comprobante no puede pesar más de 5 MB.'
  return null
}

export async function enviarComprobante(
  usuarioId: string,
  pedidoId: number,
  pedidoNumero: string,
  cuentaId: number,
  archivo: File,
  referencia: string,
): Promise<string | null> {
  const extension = archivo.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const ruta = `${usuarioId}/${pedidoNumero}-${Date.now()}.${extension}`

  const { error: subirError } = await supabase.storage
    .from('comprobantes')
    .upload(ruta, archivo, { contentType: archivo.type, upsert: false })

  if (subirError) return `No se pudo subir el comprobante: ${subirError.message}`

  const { error } = await supabase.rpc('registrar_comprobante_pedido_web', {
    p_pedido_id: pedidoId,
    p_cuenta_id: cuentaId,
    p_comprobante_path: ruta,
    p_referencia: referencia.trim() || null,
  })

  return error ? error.message : null
}

function luhnValido(numero: string) {
  let suma = 0
  let doble = false

  for (let i = numero.length - 1; i >= 0; i--) {
    let digito = Number(numero[i])
    if (doble) {
      digito *= 2
      if (digito > 9) digito -= 9
    }
    suma += digito
    doble = !doble
  }

  return suma % 10 === 0
}

export function marcaTarjeta(numero: string) {
  const n = numero.replace(/\D/g, '')
  if (/^4/.test(n)) return 'Visa'
  if (/^(5[1-5]|2[2-7])/.test(n)) return 'Mastercard'
  return null
}

// "4242424242424242" → "4242 4242 4242 4242"
export function formatearNumeroTarjeta(texto: string) {
  return texto.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ')
}

// "1230" → "12/30"
export function formatearVencimiento(texto: string) {
  const d = texto.replace(/\D/g, '').slice(0, 4)
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d
}

export function errorTarjeta(datos: DatosTarjeta): string | null {
  const numero = datos.numero.replace(/\D/g, '')

  if (datos.nombre.trim().length < 3) return 'Escribí el nombre como aparece en la tarjeta.'
  if (numero.length < 13 || !luhnValido(numero)) return 'El número de tarjeta no es válido.'
  if (!marcaTarjeta(numero)) return 'Solo se aceptan tarjetas Visa o Mastercard.'

  const vence = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(datos.vence)
  if (!vence) return 'Escribí el vencimiento como MM/AA.'

  const finDeMes = new Date(2000 + Number(vence[2]), Number(vence[1]), 1)
  if (finDeMes <= new Date()) return 'La tarjeta está vencida.'

  if (!/^\d{3,4}$/.test(datos.cvv)) return 'El código de seguridad tiene 3 dígitos (4 en algunas tarjetas).'

  return null
}

// El código de seguridad no se envía: una pasarela real lo valida y nunca se guarda.
export async function pagarConTarjeta(pedidoId: number, datos: DatosTarjeta) {
  const { data, error } = await supabase.rpc('pagar_pedido_web_tarjeta', {
    p_pedido_id: pedidoId,
    p_numero: datos.numero.replace(/\D/g, ''),
    p_vencimiento: datos.vence,
  })

  if (error) return { aprobado: false, mensaje: error.message }

  const respuesta = data as { aprobado: boolean, mensaje: string, autorizacion: string | null }
  return {
    aprobado: Boolean(respuesta.aprobado),
    mensaje: respuesta.aprobado
      ? `Pago aprobado (autorización ${respuesta.autorizacion}).`
      : `El pago fue rechazado: ${respuesta.mensaje}`,
  }
}
