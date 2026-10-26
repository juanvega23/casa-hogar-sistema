# Migraciones históricas (001–025)

Estas migraciones documentan cómo evolucionó la base de datos hasta el
26/10/2026. **Ya no se ejecutan.**

Parte del sistema (ventas, caja, propietario, tienda web y varios roles)
se creó directamente desde el SQL Editor de Supabase, sin migración. Por
eso esta cadena no podía reconstruir la base desde cero: por ejemplo, la
021 modifica `pedidos_en_linea`, que ninguna migración anterior crea.

Se reemplazaron por `supabase/migrations/20261026120000_esquema_base.sql`,
un volcado completo del esquema remoto que sí permite recrear la base.

Para cambios nuevos:

```bash
supabase migration new nombre_del_cambio
supabase db push --dry-run   # revisar qué se aplicará
supabase db push
```

No ejecutar SQL de estructura directamente en el SQL Editor: el historial
de migraciones vuelve a desincronizarse.
