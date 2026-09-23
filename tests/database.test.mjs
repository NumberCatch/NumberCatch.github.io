import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { before, after, beforeEach, afterEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// Run the real migrations in isolated PostgreSQL; only Supabase-owned schemas are stubbed.
const db = new PGlite();
const playerId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';

before(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean);
    create table storage.objects (id uuid primary key, bucket_id text, name text);
    create function storage.foldername(text) returns text[] language sql immutable as
      $$ select string_to_array($1, '/') $$;
    create publication supabase_realtime;
  `);
  const directory = new URL('../supabase/migrations/', import.meta.url);
  for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(file, directory), 'utf8'));
  }
  await db.query('insert into auth.users (id) values ($1), ($2)', [playerId, otherId]);
});

beforeEach(async () => {
  await db.exec('begin; set local role authenticated;');
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [playerId]);
});
afterEach(async () => {
  await db.exec('rollback');
});
after(async () => {
  await db.close();
});

async function capture(number, type, note = null) {
  return (
    await db.query(
      'select * from public.capture_sighting($1, $2::public.sighting_type, p_note => $3)',
      [number, type, note],
    )
  ).rows[0];
}

async function expectError(operation, code) {
  await db.exec('savepoint expected_error');
  await assert.rejects(operation, (error) => error.code === code);
  await db.exec('rollback to savepoint expected_error; release savepoint expected_error;');
}

test('confirmation stores the sighting and advances only its owner', async () => {
  assert.equal((await capture(1, 'confirmed')).current_number, 1);
  const { rows } = await db.query('select user_id, number, type from public.sightings');
  assert.deepEqual(rows, [{ user_id: playerId, number: 1, type: 'confirmed' }]);
  await db.exec('reset role');
  assert.equal(
    (await db.query('select current_number from profiles where id = $1', [otherId])).rows[0]
      .current_number,
    0,
  );
});

test('a repeated confirmation cannot insert a duplicate or roll progress back', async () => {
  await capture(1, 'confirmed');
  await capture(2, 'confirmed');
  await expectError(() => capture(1, 'confirmed'), 'NC001');
  await expectError(() => capture(2, 'confirmed'), 'NC001');
  assert.equal(
    (await db.query('select current_number from profiles where id = $1', [playerId])).rows[0]
      .current_number,
    2,
  );
  assert.equal((await db.query('select * from sightings')).rows.length, 2);
});

test('future confirmations are rejected, repeated hints remain allowed', async () => {
  await expectError(() => capture(3, 'confirmed'), 'NC002');
  assert.equal((await capture(3, 'hint')).current_number, 0);
  assert.equal((await capture(3, 'hint')).current_number, 0);
  assert.equal((await db.query('select * from sightings')).rows.length, 2);
});

test('past hints are stored without changing progress', async () => {
  await capture(3, 'hint');
  await capture(1, 'confirmed');
  assert.equal((await capture(2, 'confirmed')).current_number, 2);
  await expectError(() => capture(3, 'hint'), 'NC002');
  assert.equal((await capture(3, 'confirmed')).current_number, 3);
  assert.equal((await capture(3, 'hint')).current_number, 3);
  assert.equal((await capture(1, 'hint')).current_number, 3);
  assert.equal(
    (await db.query("select count(*)::integer as count from sightings where type = 'hint'")).rows[0]
      .count,
    3,
  );
});

test('a failed profile update also rolls back the sighting insert', async () => {
  await db.exec(`
    reset role;
    create function public.test_reject_progress() returns trigger language plpgsql as
      $$ begin raise exception 'Simulated failure'; end; $$;
    create trigger test_reject_progress before update on public.profiles
      for each row execute function public.test_reject_progress();
    set local role authenticated;
  `);
  await expectError(() => capture(1, 'confirmed'), 'P0001');
  assert.equal((await db.query('select * from sightings')).rows.length, 0);
  assert.equal(
    (await db.query('select current_number from profiles where id = $1', [playerId])).rows[0]
      .current_number,
    0,
  );
});

test('clients cannot bypass the function or write progress directly', async () => {
  await expectError(
    () => db.query('update profiles set current_number = 99 where id = $1', [playerId]),
    '42501',
  );
  await expectError(
    () =>
      db.query("insert into sightings (user_id, number, type) values ($1, 99, 'confirmed')", [
        playerId,
      ]),
    '42501',
  );
  await expectError(() => db.query("update sightings set type = 'confirmed'"), '42501');
  await expectError(
    () =>
      db.query(
        "insert into profiles (id, display_name, current_number) values (gen_random_uuid(), 'Test', 99)",
      ),
    '42501',
  );
  await db.query(
    "update profiles set display_name = 'New name', avatar_url = 'test.png', updated_at = now() where id = $1",
    [playerId],
  );
  assert.equal(
    (await db.query('select display_name from profiles where id = $1', [playerId])).rows[0]
      .display_name,
    'New name',
  );
});

test('anonymous or missing-auth calls cannot save captures', async () => {
  await db.exec('set local role anon');
  await expectError(() => capture(1, 'confirmed'), '42501');
  await db.exec(
    "set local role authenticated; select set_config('request.jwt.claim.sub', '', true);",
  );
  await expectError(() => capture(1, 'confirmed'), '42501');
});

test('only own hints may be deleted; confirmations and foreign hints are protected', async () => {
  await capture(1, 'confirmed');
  await capture(3, 'hint');
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [otherId]);
  assert.equal((await db.query('delete from sightings returning id')).rows.length, 0);
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [playerId]);
  assert.deepEqual((await db.query('delete from sightings returning type')).rows, [
    { type: 'hint' },
  ]);
  assert.equal((await db.query('select * from sightings')).rows.length, 1);
});

test('invalid capture data cannot leave partial progress', async () => {
  await expectError(() => capture(0, 'confirmed'), '22023');
  await expectError(() => capture(-1, 'hint'), '22023');
  await expectError(() => capture(null, 'hint'), '22023');
  await expectError(() => capture(1, null), '22023');
  await expectError(() => capture(1, 'confirmed', 'a'.repeat(501)), '23514');
  await expectError(
    () => db.query("select capture_sighting(1, 'confirmed', p_latitude => 50)"),
    '22023',
  );
  assert.equal((await db.query('select * from sightings')).rows.length, 0);
});

test('progress and repeated hints can exceed 999 without skipping confirmations', async () => {
  assert.equal((await capture(10000, 'hint')).current_number, 0);
  assert.equal((await capture(10000, 'hint')).current_number, 0);
  await expectError(() => capture(1000, 'confirmed'), 'NC002');
  for (let number = 1; number <= 1001; number++) {
    assert.equal((await capture(number, 'confirmed')).current_number, number);
  }
  await expectError(() => capture(1000, 'confirmed'), 'NC001');
  assert.equal((await db.query('select * from sightings')).rows.length, 1003);
});

test('table constraints still reject negative progress and nonpositive sightings', async () => {
  await db.exec('reset role');
  await expectError(
    () => db.query('update profiles set current_number = -1 where id = $1', [playerId]),
    '23514',
  );
  await expectError(
    () =>
      db.query("insert into sightings (user_id, number, type) values ($1, 0, 'hint')", [playerId]),
    '23514',
  );
});

test('the unique index also rejects duplicate confirmations outside the RPC', async () => {
  await capture(1, 'confirmed');
  await db.exec('reset role');
  await expectError(
    () =>
      db.query("insert into sightings (user_id, number, type) values ($1, 1, 'confirmed')", [
        playerId,
      ]),
    '23505',
  );
});
