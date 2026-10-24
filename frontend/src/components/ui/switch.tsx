"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
      type={type || "checkbox"}
    ref={ref}
    className={cn(
      "h-[22px] w-[40px] shrink-0 cursor-pointer appearance-none rounded-full border-2 border-transparent bg-gray-200 align-middle transition-colors duration-200 checked:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-800 after:block after:h-[18px] after:w-[18px] after:translate-x-0 after:rounded-full after:bg-white after:transition-transform checked:after:translate-x-[18px]",
      className
    )}
    {...props}
  />
));
Switch.displayName = "Switch";

export { Switch };
