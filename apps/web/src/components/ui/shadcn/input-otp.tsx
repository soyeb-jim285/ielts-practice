// shadcn/ui InputOTP (https://ui.shadcn.com/docs/components/input-otp), on the `input-otp` primitive, restyled with our tokens.
import { OTPInput, OTPInputContext } from 'input-otp';
import { Minus } from 'lucide-react';
import { useContext, type ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function InputOTP({ className, containerClassName, ...props }: ComponentProps<typeof OTPInput> & { containerClassName?: string }) {
  return (
    <OTPInput
      data-slot="input-otp"
      containerClassName={cn('flex items-center gap-2 has-disabled:opacity-50', containerClassName)}
      className={cn('disabled:cursor-not-allowed', className)}
      {...props}
    />
  );
}

function InputOTPGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="input-otp-group" className={cn('flex items-center gap-2', className)} {...props} />;
}

function InputOTPSlot({ index, className, ...props }: ComponentProps<'div'> & { index: number }) {
  const ctx = useContext(OTPInputContext);
  const { char, hasFakeCaret, isActive } = ctx?.slots[index] ?? {};
  return (
    <div
      data-slot="input-otp-slot"
      data-active={isActive}
      className={cn(
        'type-num relative flex size-12 items-center justify-center rounded-md border border-line-strong bg-card text-xl font-medium text-ink transition-[border-color,box-shadow] duration-[120ms]',
        'data-[active=true]:z-10 data-[active=true]:border-brand data-[active=true]:ring-3 data-[active=true]:ring-brand/25',
        'aria-invalid:border-bad data-[active=true]:aria-invalid:ring-bad/25',
        className,
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-5 w-px animate-caret-blink bg-ink duration-1000 motion-reduce:animate-none" />
        </div>
      )}
    </div>
  );
}

function InputOTPSeparator(props: ComponentProps<'div'>) {
  return (
    <div data-slot="input-otp-separator" role="separator" className="text-muted" {...props}>
      <Minus className="size-4" aria-hidden />
    </div>
  );
}

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator };
