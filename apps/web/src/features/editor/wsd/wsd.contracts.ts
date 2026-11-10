export interface WsdSense {
    id: string;
    workspaceId: string;
    word: string;
    senseLabel: string;
    description: string | null;
}

export interface CreateWsdSenseRequest {
    word: string;
    senseLabel: string;
    description?: string | null;
}

export interface WsdAnnotation {
    id: string;
    tokenId: string;
    senseId: string;
    /** Resolved sense label; populated by the document-level fetch, may be absent on per-token fetches. */
    senseLabel?: string | null;
    annotatorId: string;
    workspaceId: string;
    timestamp: string;
}

export interface WsdSenseImportRowError {
    rowNumber: number;
    message: string;
}

export interface WsdSenseImportSummary {
    sheetName: string;
    words: number;
    sensesInFile: number;
    created: number;
    skippedDuplicates: number;
    skippedInvalid: number;
    duplicatesInFile: number;
    errors: WsdSenseImportRowError[];
}

export interface CreateSenseWithAnnotationRequest {
    tokenId: string;
    senseLabel: string;
    description?: string | null;
}

export interface WsdSenseWithAnnotation {
    sense: WsdSense;
    annotation: WsdAnnotation;
}
