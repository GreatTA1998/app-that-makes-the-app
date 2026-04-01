<script>
  import { getFirestoreCollection } from '$lib/db/helpers.js'
  import { 
    migrateToOnList,
    migrateTemplatesToV2
  } from '$lib/db/scripts.js'

  async function getAllUsers () {
    return getFirestoreCollection('/users')
  }
</script>

<div>
  Golden rules:
  <ul>
    <li>For new schemas, always add new properties, don't overwrite old properties</li>
    <li>The only reason to overwrite old properties is if they're already invalid e.g. template.rrStr === undefined</li>
    <li>Do a test run</li>
    <li>Then do a real run on myself</li>
    <li>Temporarily comment out security rules</li>
    <li>Then do a test run on everyone</li>
    <li>Then do a real run on everyone else</li>
    <li>Re-introduce security rules</li>
  </ul>
</div>

<button onclick={async () => {
  const allUsers = await getAllUsers()
  for (const user of allUsers) {
    // await migrateToOnList(user.uid, false)    
    await migrateTemplatesToV2(user.uid, false)
    console.log('user.email =', user.email)
  }
}}>
  Migrate for all users
</button>

<button onclick={() => migrateToOnList('yGVJSutBrnS1156uopQQOBuwpMl2')}>
  Migrate to onList
</button>

<button onclick={() => migrateTemplatesToV2('yGVJSutBrnS1156uopQQOBuwpMl2')}>
  Fix and migrate templates
</button>
