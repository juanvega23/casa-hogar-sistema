import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('Faltan las variables de entorno de Supabase')
}

/*
 * Dos clientes con sesiones guardadas por separado: la del personal
 * (sistema interno) y la de los clientes (tienda). Antes compartían
 * la misma sesión del navegador, y abrir la tienda con una cuenta de
 * cliente en otra pestaña sacaba al empleado del sistema interno.
 */

// Sistema interno. No lee sesiones de enlaces de correo: el personal
// no los usa (Soporte TI asigna contraseñas temporales).
export const supabase = createClient(
  supabaseUrl,
  supabasePublishableKey,
  {
    auth: {
      storageKey: 'casa-hogar-personal',
      detectSessionInUrl: false,
    },
  },
)

// Tienda en línea (registro, recuperación de contraseña por correo).
export const supabaseTienda = createClient(
  supabaseUrl,
  supabasePublishableKey,
  {
    auth: {
      storageKey: 'casa-hogar-tienda',
    },
  },
)
