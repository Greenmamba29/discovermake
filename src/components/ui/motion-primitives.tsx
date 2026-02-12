"use client";

import { motion, MotionProps } from "framer-motion";
import { cn } from "@/lib/utils";

type MotionBoxProps = MotionProps & {
    className?: string;
    children?: React.ReactNode;
    as?: "div" | "section" | "article" | "main";
};

export const MotionBox = ({
    className,
    children,
    as = "div",
    ...props
}: MotionBoxProps) => {
    const Component = motion[as] as any; // Cast to any to avoid complex union type issues with framer-motion generic

    return (
        <Component
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className={cn(className)}
            {...props}
        >
            {children}
        </Component>
    );
};

export const MotionText = ({
    children,
    className,
    delay = 0,
    ...props
}: {
    children: React.ReactNode;
    className?: string;
    delay?: number;
} & MotionProps) => {
    return (
        <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay, ease: "easeOut" }}
            className={cn("inline-block", className)}
            {...props}
        >
            {children}
        </motion.span>
    );
};

export const FadeIn = ({
    children,
    className,
    delay = 0,
    duration = 0.5,
    direction = "up",
}: {
    children: React.ReactNode;
    className?: string;
    delay?: number;
    duration?: number;
    direction?: "up" | "down" | "left" | "right" | "none";
}) => {
    const variants = {
        hidden: {
            opacity: 0,
            y: direction === "up" ? 20 : direction === "down" ? -20 : 0,
            x: direction === "left" ? 20 : direction === "right" ? -20 : 0,
        },
        visible: {
            opacity: 1,
            y: 0,
            x: 0,
            transition: { duration, delay, ease: "easeOut" },
        },
    };

    return (
        <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
            variants={variants}
            className={className}
        >
            {children}
        </motion.div>
    );
};
