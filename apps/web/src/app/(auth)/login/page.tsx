'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/features/auth/auth.provider';
import { FullScreenLoader, Spinner } from '@/components/Spinner';
import { loginSchema, LoginFormValues } from '@/features/auth/auth.schemas';

export default function LoginPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, login } = useAuth();
  const [submitError, setSubmitError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { usernameOrEmail: '', password: '' },
  });

  // Redirect to home if already authenticated
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      router.replace('/home');
    }
  }, [isAuthenticated, authLoading, router]);

  const onSubmit = async (values: LoginFormValues) => {
    setSubmitError('');
    try {
      await login(values.usernameOrEmail, values.password);
      // Don't manually redirect - let the useEffect above handle it
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Login failed. Please try again.');
    }
  };

  // Show loading while checking auth
  if (authLoading) {
    return <FullScreenLoader label="Loading..." />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-indigo-50 via-white to-purple-50 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary opacity-10 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-500 opacity-10 rounded-full blur-3xl"></div>
      </div>

      <div className="w-full max-w-md p-8 relative z-10">
        {/* Logo/Brand Section */}
        <div className="text-center mb-10">
          <div className="flex justify-center mb-6">
            <Image
              src="/genesis-logo.svg"
              alt="Genesis Logo"
              width={200}
              height={92}
              priority
              className="h-20 w-auto"
            />
          </div>
          {/* <p className="text-slate-600 dark:text-slate-400 text-base">
            NLP Annotation Platform
          </p> */}
        </div>

        {/* Login Card */}
        <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl rounded-3xl shadow-2xl p-8 border border-slate-200/50 dark:border-slate-700/50">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-8">
            Welcome back
          </h2>

          {/* Submit error (e.g. wrong credentials) */}
          {submitError && (
            <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
            <div>
              <Label htmlFor="usernameOrEmail" className="text-slate-700 dark:text-slate-300 font-medium mb-2">
                Email or Username
              </Label>
              <Input
                id="usernameOrEmail"
                type="text"
                placeholder="you@example.com or username"
                className="h-12 rounded-xl"
                aria-invalid={!!errors.usernameOrEmail}
                {...register('usernameOrEmail')}
              />
              {errors.usernameOrEmail && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.usernameOrEmail.message}</p>
              )}
            </div>

            <div>
              <Label htmlFor="password" className="text-slate-700 dark:text-slate-300 font-medium mb-2">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  className="h-12 rounded-xl pr-12"
                  aria-invalid={!!errors.password}
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-slate-500 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] dark:text-slate-400 dark:hover:text-slate-200"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.password.message}</p>
              )}
            </div>

            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center cursor-pointer group gap-2">
                <Checkbox id="remember" />
                <span className="text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-slate-300 transition">
                  Remember me
                </span>
              </label>
              <Link
                href="#"
                className="text-primary hover:text-primary-dark transition-colors font-semibold"
              >
                Forgot password?
              </Link>
            </div>

            <Button
              type="submit"
              disabled={isSubmitting || authLoading}
              className="w-full mt-8"
              size="lg"
            >
              {(isSubmitting || authLoading) ? (
                <span className="flex items-center gap-2">
                  <Spinner className="h-5 w-5 text-current" />
                  Signing in...
                </span>
              ) : (
                'Sign in to your account'
              )}
            </Button>
          </form>

          {/* Sign Up Link */}
          <div className="mt-8 text-center">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200 dark:border-slate-700"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-white/80 dark:bg-slate-900/80 text-slate-500 dark:text-slate-400">
                  New to Genesis?
                </span>
              </div>
            </div>
            <Link
              href="/signup"
              className="mt-4 inline-block text-primary hover:text-primary-dark
                       font-semibold transition-colors"
            >
              Create an account
            </Link>
          </div>
        </div>


      </div>
    </div>
  );
}
