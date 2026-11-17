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

/** How often one ambiguous word occurs in the workspace's documents, and how many occurrences are tagged. */
export interface WsdWordCoverage {
    word: string;
    occurrences: number;
    tagged: number;
}

/** One annotation with the context needed to read it: document, sentence, sense and annotator. */
export interface WsdAnnotatedOccurrence {
    id: string;
    documentId: string;
    documentName: string;
    sentenceIndex: number;
    tokenIndex: number;
    tokenId: string;
    word: string;
    sentenceText: string;
    senseId: string;
    senseLabel: string;
    senseGloss: string | null;
    senseExamples: string | null;
    annotatorId: string;
    annotatorName: string;
    timestamp: string;
}

export interface WsdAnnotatedOverview {
    /** Distinct headwords in the workspace dictionary, whether or not they occur in the text. */
    dictionaryWords: number;
    /** Only words that occur in the documents. */
    words: WsdWordCoverage[];
    annotations: WsdAnnotatedOccurrence[];
}
