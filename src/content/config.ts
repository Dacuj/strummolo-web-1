import { defineCollection, z } from 'astro:content';

const taccuino = defineCollection({
	type: 'content', // v2.5+ o 'content' per file md/mdx
	schema: z.object({
		title: z.string(),
		description: z.string(),
		date: z.date(),
		// Qui definiamo i 4 stili artistici del tuo CSS
		style: z.enum(['tech', 'editorial', 'brutal', 'notebook']).default('tech'),
		tags: z.array(z.string()).optional(),
		// Opzionale: per i numeri "FILE_001" o "02"
		fileNumber: z.string().optional(),
		// Slug di prodotti shop da mostrare alla fine dell'articolo
		prodotti_collegati: z.array(z.string()).optional(),
	}),
});

// Collezione prodotti shop. images come array di stringhe accetta sia
// URL Cloudinary assoluti (nuovi upload) sia path relativi /img/... (back-compat).
const prodotti = defineCollection({
	type: 'content',
	schema: z.object({
		title: z.string(),
		description: z.string(),
		price: z.string(),
		images: z.array(z.string()).min(1),
		available: z.boolean().default(true).optional(),
		// Pezzi extra solo per il display dell'outfit nello shop.
		head: z.string().optional(),
		bottom: z.string().optional(),
		// Ordine dell'outfit nello shop: numero più basso = più in alto.
		order: z.number().optional(),
	}),
});

export const collections = { taccuino, prodotti };