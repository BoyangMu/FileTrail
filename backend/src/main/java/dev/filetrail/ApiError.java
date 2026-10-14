package dev.filetrail;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

public class ApiError extends RuntimeException {

    final int status;
    final String code;
    Integer partNo;

    public ApiError(int status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    static ApiError bad(String message) {
        return new ApiError(400, "INVALID_REQUEST", message);
    }

    static ApiError missing() {
        return new ApiError(
            404,
            "NOT_FOUND",
            "This item does not exist or you do not have access."
        );
    }

    static ApiError conflict(String message) {
        return new ApiError(409, "CONFLICT", message);
    }

    static ApiError corruptPart(int index) {
        var error = new ApiError(
            422,
            "STORED_PART_CORRUPT",
            "Stored content is damaged. Please upload this part again: " + index
        );
        error.partNo = index;
        return error;
    }
}

@RestControllerAdvice
class Errors {

    @ExceptionHandler({
        java.io.IOException.class,
        software.amazon.awssdk.core.exception.SdkException.class,
    })
    ResponseEntity<?> storage(Exception e) {
        return known(
            new ApiError(
                503,
                "STORAGE_UNAVAILABLE",
                "Storage is temporarily unavailable. Your progress is saved. Retry and check the upload status."
            )
        );
    }

    @ExceptionHandler(ApiError.class)
    ResponseEntity<?> known(ApiError e) {
        var body = new java.util.HashMap<String, Object>();
        body.put("code", e.code);
        body.put("message", e.getMessage());
        if (e.partNo != null) body.put("partNo", e.partNo);
        return ResponseEntity.status(e.status).body(body);
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<?> duplicate() {
        return known(
            ApiError.conflict("This name or request key already exists. Refresh and try again.")
        );
    }

    @ExceptionHandler({ HttpMessageNotReadableException.class, IllegalArgumentException.class })
    ResponseEntity<?> malformed(Exception e) {
        return known(ApiError.bad("Invalid request format."));
    }
}
