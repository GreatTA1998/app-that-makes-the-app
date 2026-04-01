import { getFirestoreQuery, updateFirestoreDoc } from '$lib/db/helpers.js'
import { query, collection, where } from 'firebase/firestore'
import { db } from '$lib/db/init.js'
import { DateTime } from 'luxon'
import type { UpdateData, DocumentData } from 'firebase/firestore'

type FirestoreDoc = Record<string, any> & { id: string; path: string }

/**
 * @param collectionPath - Assumes all documents being migrated are direct children of this collection.
 */
async function migrateCollection (
  path: string,
  outdated: (elem: FirestoreDoc) => boolean,
  correctedFields: (elem: FirestoreDoc) => UpdateData<DocumentData>,
  testRun = true
) {
  const q = query(collection(db, path))
  const dataArray = await getFirestoreQuery(q)

  const promises = dataArray.filter(outdated).map(elem => {
    const kvChanges = correctedFields(elem)
    if (testRun) {
      return console.log('elem, kvChanges, updatePath =', kvChanges, `${path}/${elem.id}`)
    } else if (testRun === false) {
      return updateFirestoreDoc(`${path}/${elem.id}`, kvChanges)
    }
  })
  console.log(`Migrating ${promises.length} tasks`)
  return Promise.all(promises)
}

export async function migrateTemplatesToV2 (uid: string, testRun = true) {
  await migrateCollection(
    `/users/${uid}/templates`,
    template => {
      const { rootID, parentID, rrStr } = template
      return [undefined, null, ''].includes(rootID) 
        || [undefined, null].includes(parentID)
        || [undefined, null].includes(rrStr)
    },
    template => {
      const { rootID, parentID, rrStr } = template
      const kvChanges: UpdateData<DocumentData> = {}
      if ([undefined, null, ''].includes(rootID)) kvChanges.rootID = template.id
      if ([undefined, null].includes(parentID)) kvChanges.parentID = ''
      if ([undefined, null].includes(rrStr)) kvChanges.rrStr = ''
      return kvChanges
    },
    testRun
  )
}

// 13209 tasks
export async function migrateToOnList (uid: string, testRun = true) {
  const basePath = `/users/${uid}/tasks`
  const q = query(collection(db, basePath))
  const tasks = await getFirestoreQuery(q)
 
  let count = 0
  const promises = []
  for (const task of tasks) {
    const { persistsOnList, isArchived, onList } = task
    if (typeof persistsOnList === 'boolean' && typeof isArchived === 'boolean') {
      if (typeof onList !== 'boolean') {
        count += 1
        const kvChanges = {
          onList: persistsOnList && !isArchived
        }
        if (testRun) {
          // console.log('kvChanges, original task =', kvChanges, task)
        }
        else if (testRun === false) {
          promises.push(
            updateFirestoreDoc(`${basePath}/${task.id}`,
              kvChanges
            )
          )
        }
      }
    } else {
      // includes modern tasks that never had `persistsOnList`, with onList true/false
      // or older routines directly on the calendar
      // either way, leave it alone
      // console.log('persistsOnList already undefined for task =', task) // technically should migrate based on `startDateISO`
    }
  }
  console.log(`Migrating ${count} tasks`)
  return Promise.all(promises)
}

export async function migrateTemplates (uid: string, testRun = true) {
  const q = query(
    collection(db, `/users/${uid}/templates`)
  )
  const templates = await getFirestoreQuery(q)
 
  let count = 0
  for (const template of templates) {
    if (!template.rootID || !template.parentID) {
      const kvChanges = {}
      if (!template.rootID) kvChanges.rootID = template.id
      if (!template.parentID) kvChanges.parentID = ''
      if (!template.rrStr === undefined) kvChanges.rrStr = ''

      if (Object.keys(kvChanges).length === 0) continue
      else {
        count += 1
        console.log('kvChanges =', kvChanges)
        console.log('task.name, .rootID =', name, rootID, parentID)
        const { name, rootID, parentID } = template
        if (!testRun) {
          updateFirestoreDoc(
            `/users/${uid}/templates/${template.id}`, 
            kvChanges
          )
        }
      }      
    }
  }
  console.log(`Migrated ${count} templates`)
}

export async function rerunRoutineGeneration (uid, testRun = true) {
  const q = query(
    collection(db, `/users/${uid}/templates`)
  )
  const templates = await getFirestoreQuery(q)
 
  let count = 0
  for (const template of templates) {
    if (template.name === 'Meditate') continue

    if (['Sunshine', 'Eye exercise'].includes(template.name)) {
      console.log('template.name, .prevEndISO =', template.name, template.prevEndISO)
      console.log('kvChanges =',  DateTime.utc().toFormat('yyyy-MM-dd'))
      if (!testRun) {
        Template.update({ 
          id: template.id, 
          kvChanges: {
            prevEndISO: DateTime.utc().toFormat('yyyy-MM-dd')
          }
        })
      }
      count += 1
    }
  }
  console.log(`Migrated ${count} templates`)
}