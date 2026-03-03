# Makefile for libchromacode — C99, depends only on zlib
CC      ?= gcc
AR      ?= ar
CFLAGS  = -std=c99 -Wall -Wextra -Wpedantic -O2 -Iinclude
LDFLAGS = -lm

# Find libz: prefer -lz, fall back to direct .so.1 path
ZLIB_DEV := $(wildcard /usr/lib/x86_64-linux-gnu/libz.so)
ifneq ($(ZLIB_DEV),)
  LDFLAGS += -lz
else
  ZLIB_RUNTIME := $(wildcard /usr/lib/x86_64-linux-gnu/libz.so.1)
  ifneq ($(ZLIB_RUNTIME),)
    LDFLAGS += $(ZLIB_RUNTIME)
  else
    LDFLAGS += -lz
  endif
endif

# Try to find zlib headers: prefer system, fall back to Node.js bundled copy
ZLIB_SYS := $(wildcard /usr/include/zlib.h)
ifeq ($(ZLIB_SYS),)
  # Use Node.js bundled zlib headers
  NODE_DIR := $(shell node -e "console.log(require('path').dirname(require('path').dirname(process.execPath)))" 2>/dev/null)
  ifneq ($(NODE_DIR),)
    CFLAGS += -I$(NODE_DIR)/include/node
  endif
endif

# Find libz.so for linking
ZLIB_LIB := $(wildcard /usr/lib/x86_64-linux-gnu/libz.so.1)
ifneq ($(ZLIB_LIB),)
  LDFLAGS += -L/usr/lib/x86_64-linux-gnu
endif

SRCDIR  = src
TESTDIR = test
BUILDDIR = build

LIB_SRCS = $(SRCDIR)/crc32.c \
           $(SRCDIR)/gf256.c \
           $(SRCDIR)/reed_solomon.c \
           $(SRCDIR)/png.c \
           $(SRCDIR)/channels.c \
           $(SRCDIR)/grid.c \
           $(SRCDIR)/interleave.c \
           $(SRCDIR)/auto_size.c \
           $(SRCDIR)/encode.c \
           $(SRCDIR)/decode.c \
           $(SRCDIR)/capacity.c

LIB_OBJS = $(patsubst $(SRCDIR)/%.c,$(BUILDDIR)/%.o,$(LIB_SRCS))

.PHONY: all clean test

all: $(BUILDDIR)/libchromacode.a $(BUILDDIR)/test_chromacode

$(BUILDDIR):
	mkdir -p $(BUILDDIR)

$(BUILDDIR)/%.o: $(SRCDIR)/%.c | $(BUILDDIR)
	$(CC) $(CFLAGS) -c $< -o $@

$(BUILDDIR)/libchromacode.a: $(LIB_OBJS)
	$(AR) rcs $@ $^

$(BUILDDIR)/test_chromacode: $(TESTDIR)/test_chromacode.c $(BUILDDIR)/libchromacode.a
	$(CC) $(CFLAGS) $< -L$(BUILDDIR) -lchromacode $(LDFLAGS) -o $@

test: $(BUILDDIR)/test_chromacode
	./$(BUILDDIR)/test_chromacode

clean:
	rm -rf $(BUILDDIR)
