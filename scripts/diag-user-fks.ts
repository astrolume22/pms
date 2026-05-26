/**
 * Diagnose every foreign key in the LIVE DB that references public.users.id
 * or auth.users.id. Reports each FK's ON DELETE behavior so we know what
 * gets nulled, cascaded, or restricted when an admin tries to delete a
 * user permanently.
 *
 * Read-only — runs only SELECTs.
 */
import './loadEnv';
import { Client } from 'pg';

interface FkRow {
  src_schema:    string;
  src_table:     string;
  src_column:    string;
  ref_schema:    string;
  ref_table:     string;
  ref_column:    string;
  on_delete:     string;
  on_update:     string;
  constraint_name: string;
}

const ON_DELETE_MAP: Record<string, string> = {
  a: 'NO ACTION',
  r: 'RESTRICT',
  c: 'CASCADE',
  n: 'SET NULL',
  d: 'SET DEFAULT',
};

async function main() {
  const url = process.env.DATABASE_URL!;
  const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const sql = `
      select
        ns.nspname               as src_schema,
        cls.relname              as src_table,
        att.attname              as src_column,
        rns.nspname              as ref_schema,
        rcls.relname             as ref_table,
        ratt.attname             as ref_column,
        c.confdeltype::text      as del_code,
        c.confupdtype::text      as upd_code,
        c.conname                as constraint_name
      from pg_constraint c
      join pg_class    cls  on cls.oid  = c.conrelid
      join pg_class    rcls on rcls.oid = c.confrelid
      join pg_namespace ns  on ns.oid   = cls.relnamespace
      join pg_namespace rns on rns.oid  = rcls.relnamespace
      cross join lateral unnest(c.conkey, c.confkey) with ordinality as k(srccol, refcol, ord)
      join pg_attribute att  on att.attrelid  = cls.oid  and att.attnum  = k.srccol
      join pg_attribute ratt on ratt.attrelid = rcls.oid and ratt.attnum = k.refcol
      where c.contype = 'f'
        and (
          (rns.nspname = 'public' and rcls.relname = 'users')
          or (rns.nspname = 'auth'   and rcls.relname = 'users')
        )
      order by rns.nspname, rcls.relname, ns.nspname, cls.relname, c.conname;
    `;
    const { rows } = await db.query<FkRow & { del_code: string; upd_code: string }>(sql);

    console.log('=== FKs referencing public.users OR auth.users ===\n');
    const grouped = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = r.ref_schema + '.' + r.ref_table;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(r);
    }
    for (const [ref, list] of grouped) {
      console.log('--- references ' + ref + ' (' + list.length + ' FKs)');
      for (const r of list) {
        const del = ON_DELETE_MAP[r.del_code] ?? r.del_code;
        const danger = del === 'CASCADE' || del === 'RESTRICT' || del === 'NO ACTION';
        console.log(
          '  ' + (danger ? '[!]' : '   ') +
          ' ' + r.src_schema + '.' + r.src_table + '.' + r.src_column +
          '  ->  ' + r.ref_table + '.' + r.ref_column +
          '   ON DELETE ' + del +
          '   (' + r.constraint_name + ')'
        );
      }
      console.log('');
    }

    console.log('=== Summary by ON DELETE action ===');
    const byAction: Record<string, FkRow[]> = {};
    for (const r of rows) {
      const a = ON_DELETE_MAP[(r as any).del_code] ?? (r as any).del_code;
      (byAction[a] = byAction[a] ?? []).push(r);
    }
    for (const [a, list] of Object.entries(byAction)) {
      console.log('  ' + a + ': ' + list.length);
    }
    console.log('');
    console.log('Total user-referencing FKs:', rows.length);
  } finally {
    await db.end();
  }
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
