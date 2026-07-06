"use client";

/** Bouton de formulaire qui demande une confirmation navigateur avant de soumettre. */
export function ConfirmSubmitButton({
  message,
  className,
  children,
}: {
  message: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(ev) => {
        if (!window.confirm(message)) {
          ev.preventDefault();
        }
      }}
    >
      {children}
    </button>
  );
}
