"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/components/auth-provider";
import { addReview, getReviews, Review } from "@/lib/firestore";
import { Star, MessageSquare, ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "./ui/textarea";

export function ReviewSection({ templateId }: { templateId: string }) {
    const { user } = useAuth();
    const [reviews, setReviews] = useState<Review[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [newRating, setNewRating] = useState(5);
    const [newComment, setNewComment] = useState("");

    useEffect(() => {
        const fetchReviews = async () => {
            const data = await getReviews(templateId);
            setReviews(data);
            setLoading(false);
        };
        fetchReviews();
    }, [templateId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user || !newComment.trim()) return;

        setSubmitting(true);
        try {
            await addReview({
                templateId,
                uid: user.uid,
                displayName: user.displayName || "Anonymous",
                rating: newRating,
                comment: newComment
            });
            setNewComment("");
            // Refresh reviews
            const data = await getReviews(templateId);
            setReviews(data);
        } catch (error) {
            console.error("Error adding review:", error);
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin h-6 w-6 text-slate-400" /></div>;

    const averageRating = reviews.length > 0
        ? (reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length).toFixed(1)
        : 0;

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <MessageSquare className="h-6 w-6 text-blue-600" />
                        Community Reviews
                    </h2>
                    <p className="text-slate-500">What makers are saying about this template</p>
                </div>
                {reviews.length > 0 && (
                    <div className="text-right">
                        <div className="flex items-center gap-1 text-2xl font-bold text-slate-900 dark:text-white">
                            <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
                            {averageRating}
                        </div>
                        <p className="text-xs text-slate-500">{reviews.length} reviews</p>
                    </div>
                )}
            </div>

            {/* Add Review Form */}
            {user ? (
                <form onSubmit={handleSubmit} className="bg-slate-50 dark:bg-slate-900/50 p-6 rounded-xl border border-slate-200 dark:border-slate-800 space-y-4">
                    <div className="flex items-center gap-4">
                        <span className="text-sm font-semibold">Your Rating:</span>
                        <div className="flex gap-1">
                            {[1, 2, 3, 4, 5].map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    onClick={() => setNewRating(s)}
                                    className={`focus:outline-none transition-transform active:scale-90 ${newRating >= s ? "text-yellow-500" : "text-slate-300"}`}
                                >
                                    <Star className={`h-6 w-6 ${newRating >= s ? "fill-yellow-500" : ""}`} />
                                </button>
                            ))}
                        </div>
                    </div>
                    <Textarea
                        placeholder="Share your experience with this template..."
                        value={newComment}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNewComment(e.target.value)}
                        className="min-h-[100px] bg-white dark:bg-slate-900"
                        required
                    />
                    <Button type="submit" disabled={submitting || !newComment.trim()}>
                        {submitting ? "Posting..." : "Post Review"}
                    </Button>
                </form>
            ) : (
                <div className="p-6 text-center bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-dashed border-slate-300 dark:border-slate-800">
                    <p className="text-slate-500">Please <a href="/login" className="text-blue-600 font-bold hover:underline">login</a> to leave a review.</p>
                </div>
            )}

            {/* Review List */}
            <div className="space-y-6">
                {reviews.length === 0 ? (
                    <p className="text-center text-slate-500 py-8">No reviews yet. Be the first to share your feedback!</p>
                ) : (
                    reviews.map((review) => (
                        <div key={review.id} className="border-b border-slate-100 dark:border-slate-800 pb-6 last:border-0">
                            <div className="flex justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <span className="font-bold text-slate-900 dark:text-white">{review.displayName}</span>
                                    {review.isVerifiedPurchase && (
                                        <span className="flex items-center gap-1 text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider">
                                            <ShieldCheck className="h-3 w-3" /> Verified Buyer
                                        </span>
                                    )}
                                </div>
                                <div className="flex gap-0.5">
                                    {[1, 2, 3, 4, 5].map((s) => (
                                        <Star key={s} className={`h-3 w-3 ${review.rating >= s ? "text-yellow-500 fill-yellow-500" : "text-slate-200"}`} />
                                    ))}
                                </div>
                            </div>
                            <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed">{review.comment}</p>
                            <p className="text-[10px] text-slate-400 mt-2">
                                {review.createdAt?.toDate?.().toLocaleDateString() || new Date().toLocaleDateString()}
                            </p>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
