export interface WsdSense {
    id: string;
    workspaceId: string;
    word: string;
    senseLabel: string;
    gloss: string | null;
    examples: string | null;
}

export interface CreateWsdSenseRequest {
    word: string;
    senseLabel: string;
    gloss?: string | null;
    examples?: string | null;
}

/** An annotator's persisted ✗: this sense does not fit this token. */
export interface WsdRejection {
    tokenId: string;
    senseId: string;
}

export interface WsdAnnotation {
    id: string;
    tokenId: string;
    senseId: string;
    /** Resolved sense label; populated by the document-level fetch, may be absent on per-token fetches. */
    senseLabel?: string | null;
    /** Document-level fetch only: surface form and sentence of the annotated token. */
    tokenForm?: string | null;
    sentenceIndex?: number | null;
    annotatorId: string;
    workspaceId: string;
    timestamp: string;
}

export interface PaginatedSenses {
    items: WsdSense[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export interface SenseSearchParams {
    word?: string;
    query?: string;
    page?: number;
    limit?: number;
}

export interface ImportSensesResult {
    totalProcessed: number;
    inserted: number;
    skipped: number;
    updated: number;
}

/** A word of the workspace's ambiguous-word list found among a set of token forms. */
export interface AmbiguousWordMatch {
    word: string;
    senseCount: number;
}
