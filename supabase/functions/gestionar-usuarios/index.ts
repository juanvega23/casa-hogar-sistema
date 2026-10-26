// =========================================================
// EDGE FUNCTION · GESTIONAR USUARIOS INTERNOS (SOPORTE TI)
//
// Crear cuentas del personal y asignar contraseñas temporales
// requiere la service_role, que nunca debe llegar al navegador.
// Esta función corre en Supabase, valida que quien la llama sea
// Soporte TI activo y registra cada acción en auditoria_usuarios.
//
// Acciones (POST, cuerpo JSON):
//   { accion: 'crear', correo, nombre, role_id, clave }
//   { accion: 'restablecer_clave', usuario_id, clave }
//
// El resto de la gestión (nombre, rol, activo) se hace con el
// RPC actualizar_usuario_interno(), que no necesita service_role.
// =========================================================

import '@supabase/functions-js/edge-runtime.d.ts'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const LONGITUD_MINIMA_CLAVE = 8

class ErrorSolicitud extends Error {
  constructor(public estado: number, mensaje: string) {
    super(mensaje)
  }
}

function responder(estado: number, cuerpo: unknown) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/*
 * Proyectos con claves antiguas exponen SUPABASE_SERVICE_ROLE_KEY;
 * con las claves nuevas existe SUPABASE_SECRET_KEYS (JSON).
 */
function claveServicio(): string {
  const antigua = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (antigua) return antigua

  const nuevas = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (nuevas) {
    try {
      const claves = JSON.parse(nuevas) as Record<string, unknown>
      const clave = claves.default ?? Object.values(claves)[0]
      if (typeof clave === 'string') return clave
    } catch {
      // Se informa abajo.
    }
  }

  throw new ErrorSolicitud(500, 'La clave de servicio no está configurada.')
}

function codigoRol(roles: unknown): string | null {
  const rol = Array.isArray(roles) ? roles[0] : roles
  return rol && typeof rol === 'object' && 'codigo' in rol
    ? String((rol as { codigo: unknown }).codigo)
    : null
}

async function verificarSoporteTi(
  admin: SupabaseClient,
  req: Request,
): Promise<string> {
  const token = (req.headers.get('Authorization') ?? '')
    .replace(/^Bearer\s+/i, '')
    .trim()

  if (!token) {
    throw new ErrorSolicitud(401, 'Debe iniciar sesión.')
  }

  const { data, error } = await admin.auth.getUser(token)

  if (error || !data.user) {
    throw new ErrorSolicitud(401, 'La sesión no es válida o expiró.')
  }

  const { data: perfil } = await admin
    .from('profiles')
    .select('activo, roles(codigo)')
    .eq('id', data.user.id)
    .maybeSingle()

  if (!perfil?.activo || codigoRol(perfil.roles) !== 'soporte_ti') {
    throw new ErrorSolicitud(403, 'Solo Soporte TI puede gestionar usuarios.')
  }

  return data.user.id
}

function validarClave(clave: unknown): string {
  if (typeof clave !== 'string' || clave.length < LONGITUD_MINIMA_CLAVE) {
    throw new ErrorSolicitud(
      400,
      `La contraseña temporal debe tener al menos ${LONGITUD_MINIMA_CLAVE} caracteres.`,
    )
  }
  return clave
}

async function registrarAuditoria(
  admin: SupabaseClient,
  fila: {
    accion: 'crear_usuario' | 'restablecer_clave'
    usuario_id: string
    descripcion: string
    detalle: Record<string, unknown>
    realizado_por: string
  },
) {
  const { error } = await admin.from('auditoria_usuarios').insert(fila)
  if (error) {
    console.error('No se pudo registrar la auditoría:', error.message)
  }
}

async function crearUsuario(
  admin: SupabaseClient,
  actor: string,
  cuerpo: Record<string, unknown>,
) {
  const correo = String(cuerpo.correo ?? '').trim().toLowerCase()
  const nombre = String(cuerpo.nombre ?? '').trim()
  const roleId = Number(cuerpo.role_id)
  const clave = validarClave(cuerpo.clave)

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    throw new ErrorSolicitud(400, 'El correo electrónico no es válido.')
  }

  if (nombre.length < 2) {
    throw new ErrorSolicitud(400, 'El nombre debe tener al menos 2 caracteres.')
  }

  if (!Number.isInteger(roleId) || roleId <= 0) {
    throw new ErrorSolicitud(400, 'Debe seleccionar un rol.')
  }

  const { data: rol } = await admin
    .from('roles')
    .select('id, nombre, activo')
    .eq('id', roleId)
    .maybeSingle()

  if (!rol?.activo) {
    throw new ErrorSolicitud(400, 'El rol seleccionado no existe o está inactivo.')
  }

  // account_type 'personal' hace que handle_new_user() cree el
  // perfil interno (y no un cliente de la tienda).
  const { data: creado, error: errorAlta } =
    await admin.auth.admin.createUser({
      email: correo,
      password: clave,
      email_confirm: true,
      user_metadata: {
        account_type: 'personal',
        full_name: nombre,
      },
    })

  if (errorAlta || !creado.user) {
    const yaExiste = /already|registered|exists/i.test(errorAlta?.message ?? '')
    throw new ErrorSolicitud(
      yaExiste ? 409 : 400,
      yaExiste
        ? 'Ya existe una cuenta con ese correo (del personal o de la tienda).'
        : `No fue posible crear la cuenta: ${errorAlta?.message ?? 'error desconocido'}`,
    )
  }

  const usuarioId = creado.user.id

  const { data: perfil, error: errorPerfil } = await admin
    .from('profiles')
    .update({
      role_id: roleId,
      nombre_completo: nombre,
      correo,
    })
    .eq('id', usuarioId)
    .select('id')
    .maybeSingle()

  if (errorPerfil || !perfil) {
    // Sin perfil la cuenta quedaría huérfana: se revierte el alta.
    await admin.auth.admin.deleteUser(usuarioId)
    throw new ErrorSolicitud(
      500,
      `No fue posible asignar el rol; la cuenta no se creó. ${errorPerfil?.message ?? ''}`.trim(),
    )
  }

  await registrarAuditoria(admin, {
    accion: 'crear_usuario',
    usuario_id: usuarioId,
    descripcion: `Alta de ${correo} con el rol ${rol.nombre}`,
    detalle: { correo, role_id: roleId },
    realizado_por: actor,
  })

  return { id: usuarioId, correo }
}

async function restablecerClave(
  admin: SupabaseClient,
  actor: string,
  cuerpo: Record<string, unknown>,
) {
  const usuarioId = String(cuerpo.usuario_id ?? '')
  const clave = validarClave(cuerpo.clave)

  // Solo cuentas del personal: los clientes de la tienda usan
  // su propia recuperación por correo.
  const { data: perfil } = await admin
    .from('profiles')
    .select('id, nombre_completo, correo')
    .eq('id', usuarioId)
    .maybeSingle()

  if (!perfil) {
    throw new ErrorSolicitud(404, 'El usuario interno indicado no existe.')
  }

  const { error } = await admin.auth.admin.updateUserById(usuarioId, {
    password: clave,
  })

  if (error) {
    throw new ErrorSolicitud(400, `No fue posible cambiar la contraseña: ${error.message}`)
  }

  await registrarAuditoria(admin, {
    accion: 'restablecer_clave',
    usuario_id: usuarioId,
    descripcion: `Contraseña temporal asignada a ${perfil.correo ?? perfil.nombre_completo ?? usuarioId}`,
    detalle: {},
    realizado_por: actor,
  })

  return { id: usuarioId }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  if (req.method !== 'POST') {
    return responder(405, { error: 'Método no permitido.' })
  }

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      claveServicio(),
      { auth: { persistSession: false, autoRefreshToken: false } },
    )

    const actor = await verificarSoporteTi(admin, req)

    const cuerpo = (await req.json().catch(() => ({}))) as Record<string, unknown>

    if (cuerpo.accion === 'crear') {
      return responder(200, await crearUsuario(admin, actor, cuerpo))
    }

    if (cuerpo.accion === 'restablecer_clave') {
      return responder(200, await restablecerClave(admin, actor, cuerpo))
    }

    return responder(400, { error: 'Acción no válida.' })
  } catch (err) {
    if (err instanceof ErrorSolicitud) {
      return responder(err.estado, { error: err.message })
    }

    console.error(err)
    return responder(500, { error: 'Error interno al gestionar el usuario.' })
  }
})
