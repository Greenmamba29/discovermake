import { db } from './firebase';

/**
 * SECURITY RULES AUDIT (Draft)
 * 
 * Target: Firestore
 * Alignment: Google Support Docs (Least Privilege)
 */

/*
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // User Profiles
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Templates (Public Read)
    match /templates/{templateId} {
      allow read: if true;
      allow write: if request.auth != null && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    
    // Orders (Private)
    match /orders/{orderId} {
      allow read: if request.auth != null && resource.data.userId == request.auth.uid;
      allow create: if request.auth != null;
      allow update: if false; // Only via Admin SDK / Webhooks
    }
    
  }
}
*/
