import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import LoginApi from '../api/LoginApi';
import { useAuthStore } from '../../../common/state/authStore';
import RouterManager from '../../../common/router/RouterManager';
import { RoutePath } from '../../../common/router/RoutePath';

export function useLoginViewModel() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const setAuth = useAuthStore((s) => s.setAuth);

  const sendCodeMutation = useMutation({
    mutationFn: async () => {
      await LoginApi.sendCode(phone);
    },
    onSuccess: () => {
      setCountdown(60);
      const timer = window.setInterval(() => {
        setCountdown((current) => {
          if (current <= 1) {
            window.clearInterval(timer);
            return 0;
          }
          return current - 1;
        });
      }, 1000);
    },
  });

  const loginMutation = useMutation({
    mutationFn: async () => LoginApi.login(phone, code),
    onSuccess: (result) => {
      setAuth(result.token, result.user);
      RouterManager.navigate(RoutePath.DATA, { replace: true });
    },
  });

  return {
    phone,
    setPhone,
    code,
    setCode,
    countdown,
    sendCode: () => sendCodeMutation.mutate(),
    login: () => loginMutation.mutate(),
    sending: sendCodeMutation.isPending,
    logining: loginMutation.isPending,
    error: sendCodeMutation.error?.message ?? loginMutation.error?.message ?? null,
  };
}
