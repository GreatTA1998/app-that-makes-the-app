import {
  doc, setDoc, getDoc, updateDoc, deleteDoc,
  collection, getDocs, query, where, limit,
  writeBatch, arrayRemove, increment, onSnapshot
} from 'firebase/firestore'
import { db } from './init'
import { deleteObject, getStorage, ref } from 'firebase/storage'
import type { UpdateData, DocumentData } from 'firebase/firestore'

export async function listenTo (q, onUpdate) {
  return onSnapshot(q, snap => 
    onUpdate(snap.docs.map(doc => ({ ...doc.data(), id: doc.id })))
  )
}

export function firestoreRef (path) {
  return doc(db, path)
}

export async function setFirestoreDoc (path, newObject) {
  try {
    const ref = firestoreRef(path)
    return await setDoc(ref, newObject, { merge: true })
  } catch (error) {
    console.error('error in setFirestoreDoc, CRUD', error)
    console.error('payload was =', newObject)
  }
}

export function getFirestoreDoc (path) {
  return new Promise(async (resolve, reject) => {
    const ref = firestoreRef(path)
    try {
      const snapshot = await getDoc(ref)
      if (!snapshot.exists()) resolve(null)
      else {
        resolve({ id: snapshot.id, path: snapshot.ref.path, ...snapshot.data() })
      }
    } catch (error) {
      console.log('error =', error)
      reject(error)
    }
  })
}

export async function getFirestoreCollection (path) {
  const ref = collection(db, path)
  const snapshot = await getDocs(ref)
  const data = []
  snapshot.forEach((doc) => {
    data.push({ id: doc.id, path: doc.ref.path, ...doc.data() })
  })
  return data
}

export async function getFirestoreQuery (query) {
  const snapshot = await getDocs(query)
  return snapshot.docs.map(
    doc => ({ ...doc.data(), id: doc.id, path: doc.ref.path })
  )
}

export async function updateFirestoreDoc (path: string, data: UpdateData<DocumentData>) {
  const ref = firestoreRef(path)
  return updateDoc(ref, data)
}

export function createFirestoreQuery ({ collectionPath, criteriaTerms }) {
  const ref = collection(db, collectionPath)
  const q = query(
    ref,
    where(criteriaTerms[0], criteriaTerms[1], criteriaTerms[2])
  )
  return q
}

export function deleteFirestoreDoc (path) {
  const ref = firestoreRef(path)
  return deleteDoc(ref)
}

async function countImageRefs (uid, collectionName, imageDownloadURL) {
  const snapshot = await getDocs(
    query(
      collection(db, `/users/${uid}/${collectionName}`),
      where('imageDownloadURL', '==', imageDownloadURL),
      limit(2)
    )
  )
  return snapshot.size
}

export async function releaseImage (uid, { imageFullPath, imageDownloadURL }) {
  const [taskCount, templateCount] = await Promise.all([
    countImageRefs(uid, 'tasks', imageDownloadURL),
    countImageRefs(uid, 'templates', imageDownloadURL)
  ])
  if (taskCount + templateCount === 1) {
    deleteImage({ imageFullPath })
  }
}

async function deleteImage ({ imageFullPath }) {
  const storage = getStorage()
  await deleteObject(ref(storage, imageFullPath))
} 