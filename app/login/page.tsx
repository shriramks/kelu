'use client'

import { Suspense } from 'react'
import LoginForm from './LoginForm'

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginForm />
    </Suspense>
  )
}

function LoginSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Kelu</h1>
          <p className="text-sm text-gray-500 mt-1">Financial News Dashboard</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 animate-pulse">
          <div className="h-8 bg-gray-100 rounded-lg mb-6" />
          <div className="space-y-4">
            <div className="h-10 bg-gray-100 rounded-lg" />
            <div className="h-10 bg-gray-100 rounded-lg" />
            <div className="h-10 bg-gray-200 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  )
}
