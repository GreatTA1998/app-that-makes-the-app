<script>
  import { getFirestoreCollection } from '$lib/db/helpers.js'
  import { 
    migrateToOnList,
    migrateTemplatesToV2
  } from '$lib/db/scripts.js'
  import Analytics from '$lib/Analytics.svelte'
  import ErrorLogs from '$lib/ErrorLogs.svelte'

  async function getAllUsers () {
    return getFirestoreCollection('/users')
  }
</script>

<div class="p-4 space-y-6 text-[15px] text-neutral-900">
  <Analytics />

  <ErrorLogs />

  <section class="space-y-2">
    <h1 class="text-lg font-semibold tracking-tight">Database migration principles</h1>
    <ul class="list-disc pl-5 space-y-0.5 text-neutral-700">
      <li>For new schemas, always add new properties, don't overwrite old properties</li>
      <li>The only reason to overwrite old properties is if they're already invalid e.g. template.rrStr === undefined</li>
      <li>Do a test run</li>
      <li>Then do a real run on myself</li>
      <li>Temporarily comment out security rules</li>
      <li>Then do a test run on everyone</li>
      <li>Then do a real run on everyone else</li>
      <li>Re-introduce security rules</li>
    </ul>
  </section>

  <div class="flex flex-wrap gap-2">
    <button
      class="px-2.5 py-1 border border-neutral-200 rounded-md bg-white"
      onclick={async () => {
        const allUsers = await getAllUsers()
        for (const user of allUsers) {
          // await migrateToOnList(user.uid, false)    
          // await migrateTemplatesToV2(user.uid, false)
          console.log('user.email =', user.email)
        }
      }}
    >
      Migrate for all users
    </button>

    <button
      class="px-2.5 py-1 border border-neutral-200 rounded-md bg-white"
      onclick={() => migrateToOnList('yGVJSutBrnS1156uopQQOBuwpMl2')}
    >
      Migrate to onList
    </button>

    <button
      class="px-2.5 py-1 border border-neutral-200 rounded-md bg-white"
      onclick={() => migrateTemplatesToV2('yGVJSutBrnS1156uopQQOBuwpMl2')}
    >
      Fix and migrate templates
    </button>
  </div>
</div>
