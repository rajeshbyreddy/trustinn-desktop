FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    clang \
    g++ \
    gcc \
    make \
    python3 \
    python-is-python3 \
    python3-pip \
    python3-tabulate \
    libtcmalloc-minimal4 \
    z3 \
    cbmc \
    wget \
    unzip \
    default-jdk \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && (apt-get install -y --no-install-recommends jbmc || true) && rm -rf /var/lib/apt/lists/*

RUN python3 -m pip install --no-cache-dir tabulate

WORKDIR /workspace
COPY . /workspace

RUN chmod -R +x /workspace/ADVANCE_CODE_COVERAGE_PROFILER \
    /workspace/CC-BOUNDED\ MODEL\ CHECKER \
    /workspace/DSE_MUTATION_ANALYSER \
    /workspace/DSE_WITH_PRUNING \
    /workspace/DYNAMIC_SYMBOLIC_EXECUTION \
    /workspace/JAVA \
    /workspace/MUTATION_TESTING_PROFILER \
    /workspace/PYTHON \
    /workspace/SOLIDITY || true

RUN mkdir -p /opt/trustinn /results
COPY trustinn-desktop/docker/runner.py /opt/trustinn/runner.py
RUN chmod +x /opt/trustinn/runner.py

ENTRYPOINT ["python3", "/opt/trustinn/runner.py"]
